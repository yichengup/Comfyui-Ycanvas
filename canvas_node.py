from PIL import Image, ImageOps
import hashlib
import torch
import numpy as np
import folder_paths
from server import PromptServer
from aiohttp import web
import os
from tqdm import tqdm
from torchvision import transforms
from transformers import AutoModelForImageSegmentation, PretrainedConfig
import torch.nn.functional as F
import traceback

# 设置高精度计算
torch.set_float32_matmul_precision('high')

# 定义配置类
class BiRefNetConfig(PretrainedConfig):
    model_type = "BiRefNet"
    def __init__(self, bb_pretrained=False, **kwargs):
        self.bb_pretrained = bb_pretrained
        super().__init__(**kwargs)

# 定义模型类
class BiRefNet(torch.nn.Module):
    def __init__(self, config):
        super().__init__()
        # 基本网络结构
        self.encoder = torch.nn.Sequential(
            torch.nn.Conv2d(3, 64, kernel_size=3, padding=1),
            torch.nn.ReLU(inplace=True),
            torch.nn.Conv2d(64, 64, kernel_size=3, padding=1),
            torch.nn.ReLU(inplace=True)
        )
        
        self.decoder = torch.nn.Sequential(
            torch.nn.Conv2d(64, 32, kernel_size=3, padding=1),
            torch.nn.ReLU(inplace=True),
            torch.nn.Conv2d(32, 1, kernel_size=1)
        )
        
    def forward(self, x):
        features = self.encoder(x)
        output = self.decoder(features)
        return [output]

class CanvasView:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "canvas_image": ("STRING", {"default": "canvas_image.png"}),
                "trigger": ("INT", {"default": 0, "min": 0, "max": 99999999, "step": 1})
            },
            "hidden": {
                "unique_id": "UNIQUE_ID"
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "process_canvas_image"
    CATEGORY = "ycnode"

    def process_canvas_image(self, canvas_image, trigger, unique_id):
        try:
            # 读取保存的画布图像和遮
            path_image = folder_paths.get_annotated_filepath(canvas_image)
            path_mask = folder_paths.get_annotated_filepath(canvas_image.replace('.png', '_mask.png'))
            
            # 处理主图像
            i = Image.open(path_image)
            i = ImageOps.exif_transpose(i)
            if i.mode not in ['RGB', 'RGBA']:
                i = i.convert('RGB')
            image = np.array(i).astype(np.float32) / 255.0
            if i.mode == 'RGBA':
                rgb = image[..., :3]
                alpha = image[..., 3:]
                image = rgb * alpha + (1 - alpha) * 0.5
            
            # 处理遮罩图像
            try:
                mask = Image.open(path_mask).convert('L')
                mask = np.array(mask).astype(np.float32) / 255.0
                mask = torch.from_numpy(mask)[None,]
            except:
                # 如果没有遮罩文件，创建空白遮罩
                mask = torch.zeros((1, image.shape[0], image.shape[1]), dtype=torch.float32)
            
            # 转换为tensor
            image = torch.from_numpy(image)[None,]
            
            return (image, mask)
        except Exception as e:
            print(f"Error processing canvas image: {str(e)}")
            # 回白色图像和空白遮罩
            blank = np.ones((512, 512, 3), dtype=np.float32)
            blank_mask = np.zeros((512, 512), dtype=np.float32)
            return (torch.from_numpy(blank)[None,], torch.from_numpy(blank_mask)[None,])

class BiRefNetMatting:
    def __init__(self):
        self.model = None
        self.model_path = None
        self.model_cache = {}
        # 使用 ComfyUI models 目录
        self.base_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "models")

    def load_model(self, model_path):
        try:
            if model_path not in self.model_cache:
                # 使用 ComfyUI models 目录下的 BiRefNet 路径
                full_model_path = os.path.join(self.base_path, "BiRefNet")
                
                print(f"Loading BiRefNet model from {full_model_path}...")
                
                try:
                    # 直接从Hugging Face加载
                    self.model = AutoModelForImageSegmentation.from_pretrained(
                        "ZhengPeng7/BiRefNet",
                        trust_remote_code=True,
                        cache_dir=full_model_path  # 使用本地缓存目录
                    )
                    
                    # 设置为评估模式并移动到GPU
                    self.model.eval()
                    if torch.cuda.is_available():
                        self.model = self.model.cuda()
                        
                    self.model_cache[model_path] = self.model
                    print("Model loaded successfully from Hugging Face")
                    print(f"Model type: {type(self.model)}")
                    print(f"Model device: {next(self.model.parameters()).device}")
                    
                except Exception as e:
                    print(f"Failed to load model: {str(e)}")
                    raise
                    
            else:
                self.model = self.model_cache[model_path]
                print("Using cached model")
                
            return True
            
        except Exception as e:
            print(f"Error loading model: {str(e)}")
            traceback.print_exc()
            return False

    def preprocess_image(self, image):
        """预处理输入图像"""
        try:
            # 转换为PIL图像
            if isinstance(image, torch.Tensor):
                if image.dim() == 4:
                    image = image.squeeze(0)
                if image.dim() == 3:
                    image = transforms.ToPILImage()(image)
            
            # 参考nodes.py的预处理
            transform_image = transforms.Compose([
                transforms.Resize((1024, 1024)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])
            
            # 转换为tensor并添加batch维度
            image_tensor = transform_image(image).unsqueeze(0)
            
            if torch.cuda.is_available():
                image_tensor = image_tensor.cuda()
                
            return image_tensor
        except Exception as e:
            print(f"Error preprocessing image: {str(e)}")
            return None

    def execute(self, image, model_path, threshold=0.5, refinement=1):
        try:
            # 发送开始状态
            PromptServer.instance.send_sync("matting_status", {"status": "processing"})
            
            # 加载模型
            if not self.load_model(model_path):
                raise RuntimeError("Failed to load model")
            
            # 获取原始尺寸
            if isinstance(image, torch.Tensor):
                original_size = image.shape[-2:] if image.dim() == 4 else image.shape[-2:]
            else:
                original_size = image.size[::-1]
            
            print(f"Original size: {original_size}")
            
            # 预处理图像
            processed_image = self.preprocess_image(image)
            if processed_image is None:
                raise Exception("Failed to preprocess image")
            
            print(f"Processed image shape: {processed_image.shape}")
            
            # 执行推理
            with torch.no_grad():
                outputs = self.model(processed_image)
                result = outputs[-1].sigmoid().cpu()
                print(f"Model output shape: {result.shape}")
                
                # 确保结果有正的维度格式 [B, C, H, W]
                if result.dim() == 3:
                    result = result.unsqueeze(1)  # 添加通道维度
                elif result.dim() == 2:
                    result = result.unsqueeze(0).unsqueeze(0)  # 添加batch和通道维度
                
                print(f"Reshaped result shape: {result.shape}")
                
                # 调整大小
                result = F.interpolate(
                    result,
                    size=(original_size[0], original_size[1]),  # 明确指定高度和宽度
                    mode='bilinear',
                    align_corners=True
                )
                print(f"Resized result shape: {result.shape}")
                
                # 归一化
                result = result.squeeze()  # 移除多余的维度
                ma = torch.max(result)
                mi = torch.min(result)
                result = (result-mi)/(ma-mi)
                
                # 应用阈值
                if threshold > 0:
                    result = (result > threshold).float()
                
                # 创建mask和结果图像
                alpha_mask = result.unsqueeze(0).unsqueeze(0)  # 确保mask是 [1, 1, H, W]
                if isinstance(image, torch.Tensor):
                    if image.dim() == 3:
                        image = image.unsqueeze(0)
                    masked_image = image * alpha_mask
                else:
                    image_tensor = transforms.ToTensor()(image).unsqueeze(0)
                    masked_image = image_tensor * alpha_mask
                
                # 发送完成状态
                PromptServer.instance.send_sync("matting_status", {"status": "completed"})
                
                return (masked_image, alpha_mask)
                
        except Exception as e:
            # 发送错误状态
            PromptServer.instance.send_sync("matting_status", {"status": "error"})
            raise e

    @classmethod
    def IS_CHANGED(cls, image, model_path, threshold, refinement):
        """检查输入是否改变"""
        m = hashlib.md5()
        m.update(str(image).encode())
        m.update(str(model_path).encode())
        m.update(str(threshold).encode())
        m.update(str(refinement).encode())
        return m.hexdigest()

@PromptServer.instance.routes.post("/matting")
async def matting(request):
    try:
        print("Received matting request")
        data = await request.json()
        
        # 获取BiRefNet实例
        matting = BiRefNetMatting()
        
        # 处理图像数据,现在返回图像tensor和alpha通道
        image_tensor, original_alpha = convert_base64_to_tensor(data["image"])
        print(f"Input image shape: {image_tensor.shape}")
        
        # 执行抠图
        matted_image, alpha_mask = matting.execute(
            image_tensor, 
            "BiRefNet/model.safetensors",
            threshold=data.get("threshold", 0.5),
            refinement=data.get("refinement", 1)
        )
        
        # 转换结果为base64,包含原始alpha信息
        result_image = convert_tensor_to_base64(matted_image, alpha_mask, original_alpha)
        result_mask = convert_tensor_to_base64(alpha_mask)
        
        return web.json_response({
            "matted_image": result_image,
            "alpha_mask": result_mask
        })
        
    except Exception as e:
        print(f"Error in matting endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "error": str(e),
            "details": traceback.format_exc()
        }, status=500)

def convert_base64_to_tensor(base64_str):
    """将base64图像数据转换为tensor,保留alpha通道"""
    import base64
    import io
    
    try:
        # 解码base64数据
        img_data = base64.b64decode(base64_str.split(',')[1])
        img = Image.open(io.BytesIO(img_data))
        
        # 保存原始alpha通道
        has_alpha = img.mode == 'RGBA'
        alpha = None
        if has_alpha:
            alpha = img.split()[3]
            # 创建白色背景
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=alpha)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 转换为tensor
        transform = transforms.ToTensor()
        img_tensor = transform(img).unsqueeze(0)  # [1, C, H, W]
        
        if has_alpha:
            # 将alpha转换为tensor并保存
            alpha_tensor = transforms.ToTensor()(alpha).unsqueeze(0)  # [1, 1, H, W]
            return img_tensor, alpha_tensor
        
        return img_tensor, None
        
    except Exception as e:
        print(f"Error in convert_base64_to_tensor: {str(e)}")
        raise

def convert_tensor_to_base64(tensor, alpha_mask=None, original_alpha=None):
    """将tensor转换为base64图像数据,支持alpha通道"""
    import base64
    import io
    
    try:
        # 确保tensor在CPU上
        tensor = tensor.cpu()
        
        # 处理维度
        if tensor.dim() == 4:
            tensor = tensor.squeeze(0)  # 移除batch维度
        if tensor.dim() == 3 and tensor.shape[0] in [1, 3]:
            tensor = tensor.permute(1, 2, 0)
            
        # 转换为numpy数组并调整值范围到0-255
        img_array = (tensor.numpy() * 255).astype(np.uint8)
        
        # 如果有alpha遮罩和原始alpha
        if alpha_mask is not None and original_alpha is not None:
            # 将alpha_mask转换为正确的格式
            alpha_mask = alpha_mask.cpu().squeeze().numpy()
            alpha_mask = (alpha_mask * 255).astype(np.uint8)
            
            # 将原始alpha转换为正确的格式
            original_alpha = original_alpha.cpu().squeeze().numpy()
            original_alpha = (original_alpha * 255).astype(np.uint8)
            
            # 组合alpha_mask和original_alpha
            combined_alpha = np.minimum(alpha_mask, original_alpha)
            
            # 创建RGBA图像
            img = Image.fromarray(img_array, mode='RGB')
            alpha_img = Image.fromarray(combined_alpha, mode='L')
            img.putalpha(alpha_img)
        else:
            # 处理没有alpha通道的情况
            if img_array.shape[-1] == 1:
                img_array = img_array.squeeze(-1)
                img = Image.fromarray(img_array, mode='L')
            else:
                img = Image.fromarray(img_array, mode='RGB')
        
        # 转换为base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        
        return f"data:image/png;base64,{img_str}"
        
    except Exception as e:
        print(f"Error in convert_tensor_to_base64: {str(e)}")
        print(f"Tensor shape: {tensor.shape}, dtype: {tensor.dtype}")
        raise
