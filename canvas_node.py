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
import uuid
import time
import base64
from PIL import Image
import io

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

class CanvasNode:
    _canvas_cache = {
        'image': None,
        'mask': None,
        'cache_enabled': True,
        'data_flow_status': {},
        'persistent_cache': {},
        'last_execution_id': None
    }
    
    def __init__(self):
        super().__init__()
        self.flow_id = str(uuid.uuid4())
        # 从持久化缓存恢复数据
        if self.__class__._canvas_cache['persistent_cache']:
            self.restore_cache()

    def restore_cache(self):
        """从持久化缓存恢复数据，除非是新的执行"""
        try:
            persistent = self.__class__._canvas_cache['persistent_cache']
            current_execution = self.get_execution_id()
            
            # 只有在新的执行ID时才清除缓存
            if current_execution != self.__class__._canvas_cache['last_execution_id']:
                print(f"New execution detected: {current_execution}")
                self.__class__._canvas_cache['image'] = None
                self.__class__._canvas_cache['mask'] = None
                self.__class__._canvas_cache['last_execution_id'] = current_execution
            else:
                # 否则保留现有缓存
                if persistent.get('image') is not None:
                    self.__class__._canvas_cache['image'] = persistent['image']
                    print("Restored image from persistent cache")
                if persistent.get('mask') is not None:
                    self.__class__._canvas_cache['mask'] = persistent['mask']
                    print("Restored mask from persistent cache")
        except Exception as e:
            print(f"Error restoring cache: {str(e)}")

    def get_execution_id(self):
        """获取当前工作流执行ID"""
        try:
            # 可以使用时间戳或其他唯一标识
            return str(int(time.time() * 1000))
        except Exception as e:
            print(f"Error getting execution ID: {str(e)}")
            return None

    def update_persistent_cache(self):
        """更新持久化缓存"""
        try:
            self.__class__._canvas_cache['persistent_cache'] = {
                'image': self.__class__._canvas_cache['image'],
                'mask': self.__class__._canvas_cache['mask']
            }
            print("Updated persistent cache")
        except Exception as e:
            print(f"Error updating persistent cache: {str(e)}")

    def track_data_flow(self, stage, status, data_info=None):
        """追踪数据流状态"""
        flow_status = {
            'timestamp': time.time(),
            'stage': stage,
            'status': status,
            'data_info': data_info
        }
        print(f"Data Flow [{self.flow_id}] - Stage: {stage}, Status: {status}")
        if data_info:
            print(f"Data Info: {data_info}")
        
        self.__class__._canvas_cache['data_flow_status'][self.flow_id] = flow_status

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "canvas_image": ("STRING", {"default": "canvas_image.png"}),
                "trigger": ("INT", {"default": 0, "min": 0, "max": 99999999, "step": 1, "hidden": True}),
                "output_switch": ("BOOLEAN", {"default": True}),
                "cache_enabled": ("BOOLEAN", {"default": True, "label": "Enable Cache"})
            },
            "optional": {
                "input_image": ("IMAGE",),
                "input_mask": ("MASK",)
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "process_canvas_image"
    CATEGORY = "Ycanvas"

    def add_image_to_canvas(self, input_image):
        """处理输入图像"""
        try:
            # 确保输入图像是正确的格式
            if not isinstance(input_image, torch.Tensor):
                raise ValueError("Input image must be a torch.Tensor")
            
            # 处理图像维度
            if input_image.dim() == 4:
                input_image = input_image.squeeze(0)
            
            # 转换为标准格式
            if input_image.dim() == 3 and input_image.shape[0] in [1, 3]:
                input_image = input_image.permute(1, 2, 0)
            
            return input_image
            
        except Exception as e:
            print(f"Error in add_image_to_canvas: {str(e)}")
            return None

    def add_mask_to_canvas(self, input_mask, input_image):
        """处理输入遮罩"""
        try:
            # 确保输入遮罩是正确的格式
            if not isinstance(input_mask, torch.Tensor):
                raise ValueError("Input mask must be a torch.Tensor")
            
            # 处理遮罩维度
            if input_mask.dim() == 4:
                input_mask = input_mask.squeeze(0)
            if input_mask.dim() == 3 and input_mask.shape[0] == 1:
                input_mask = input_mask.squeeze(0)
            
            # 确保遮罩尺寸与图像匹配
            if input_image is not None:
                expected_shape = input_image.shape[:2]
                if input_mask.shape != expected_shape:
                    input_mask = F.interpolate(
                        input_mask.unsqueeze(0).unsqueeze(0),
                        size=expected_shape,
                        mode='bilinear',
                        align_corners=False
                    ).squeeze()
            
            return input_mask
            
        except Exception as e:
            print(f"Error in add_mask_to_canvas: {str(e)}")
            return None

    def process_canvas_image(self, canvas_image, trigger, output_switch, cache_enabled, input_image=None, input_mask=None):
        try:
            current_execution = self.get_execution_id()
            print(f"Processing canvas image, execution ID: {current_execution}")
            
            # 检查是否是新的执行
            if current_execution != self.__class__._canvas_cache['last_execution_id']:
                print(f"New execution detected: {current_execution}")
                # 清除旧的缓存
                self.__class__._canvas_cache['image'] = None
                self.__class__._canvas_cache['mask'] = None
                self.__class__._canvas_cache['last_execution_id'] = current_execution
            
            # 处理输入图像
            if input_image is not None:
                print("Input image received, converting to PIL Image...")
                # 将tensor转换为PIL Image并存储到缓存
                if isinstance(input_image, torch.Tensor):
                    if input_image.dim() == 4:
                        input_image = input_image.squeeze(0)  # 移除batch维度
                    
                    # 确保图像格式为[H, W, C]
                    if input_image.shape[0] == 3:  # 如果是[C, H, W]格式
                        input_image = input_image.permute(1, 2, 0)
                    
                    # 转换为numpy数组并确保值范围在0-255
                    image_array = (input_image.cpu().numpy() * 255).astype(np.uint8)
                    
                    # 确保数组形状正确
                    if len(image_array.shape) == 2:  # 如果是灰度图
                        image_array = np.stack([image_array] * 3, axis=-1)
                    elif len(image_array.shape) == 3 and image_array.shape[-1] != 3:
                        image_array = np.transpose(image_array, (1, 2, 0))
                    
                    try:
                        # 转换为PIL Image
                        pil_image = Image.fromarray(image_array, 'RGB')
                        print("Successfully converted to PIL Image")
                        # 存储PIL Image到缓存
                        self.__class__._canvas_cache['image'] = pil_image
                        print(f"Image stored in cache with size: {pil_image.size}")
                    except Exception as e:
                        print(f"Error converting to PIL Image: {str(e)}")
                        print(f"Array shape: {image_array.shape}, dtype: {image_array.dtype}")
                        raise
            
            # 处理输入遮罩
            if input_mask is not None:
                print("Input mask received, converting to PIL Image...")
                if isinstance(input_mask, torch.Tensor):
                    if input_mask.dim() == 4:
                        input_mask = input_mask.squeeze(0)
                    if input_mask.dim() == 3 and input_mask.shape[0] == 1:
                        input_mask = input_mask.squeeze(0)
                    
                    # 转换为PIL Image
                    mask_array = (input_mask.cpu().numpy() * 255).astype(np.uint8)
                    pil_mask = Image.fromarray(mask_array, 'L')
                    print("Successfully converted mask to PIL Image")
                    # 存储遮罩到缓存
                    self.__class__._canvas_cache['mask'] = pil_mask
                    print(f"Mask stored in cache with size: {pil_mask.size}")
            
            # 更新缓存开关状态
            self.__class__._canvas_cache['cache_enabled'] = cache_enabled
            
            try:
                # 尝试读取画布图像
                path_image = folder_paths.get_annotated_filepath(canvas_image)
                i = Image.open(path_image)
                i = ImageOps.exif_transpose(i)
                if i.mode not in ['RGB', 'RGBA']:
                    i = i.convert('RGB')
                image = np.array(i).astype(np.float32) / 255.0
                if i.mode == 'RGBA':
                    rgb = image[..., :3]
                    alpha = image[..., 3:]
                    image = rgb * alpha + (1 - alpha) * 0.5
                processed_image = torch.from_numpy(image)[None,]
            except Exception as e:
                # 如果读取失败，创建白色画布
                processed_image = torch.ones((1, 512, 512, 3), dtype=torch.float32)
            
            try:
                # 尝试读取遮罩图像
                path_mask = path_image.replace('.png', '_mask.png')
                if os.path.exists(path_mask):
                    mask = Image.open(path_mask).convert('L')
                    mask = np.array(mask).astype(np.float32) / 255.0
                    processed_mask = torch.from_numpy(mask)[None,]
                else:
                    # 如果没有遮罩文件，创建全白遮罩
                    processed_mask = torch.ones((1, processed_image.shape[1], processed_image.shape[2]), dtype=torch.float32)
            except Exception as e:
                print(f"Error loading mask: {str(e)}")
                # 创建默认遮罩
                processed_mask = torch.ones((1, processed_image.shape[1], processed_image.shape[2]), dtype=torch.float32)
            
            # 输出处理
            if not output_switch:
                return ()
            
            # 更新持久化缓存
            self.update_persistent_cache()
            
            # 返回处理后的图像和遮罩
            return (processed_image, processed_mask)
                
        except Exception as e:
            print(f"Error in process_canvas_image: {str(e)}")
            traceback.print_exc()
            return ()

    # 添加获取缓存数据的方法
    def get_cached_data(self):
        return {
            'image': self.__class__._canvas_cache['image'],
            'mask': self.__class__._canvas_cache['mask']
        }

    # 添加API路由处理器
    @classmethod
    def api_get_data(cls, node_id):
        try:
            return {
                'success': True,
                'data': cls._canvas_cache
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    @classmethod
    def get_flow_status(cls, flow_id=None):
        """获取数据流状态"""
        if flow_id:
            return cls._canvas_cache['data_flow_status'].get(flow_id)
        return cls._canvas_cache['data_flow_status']

    @classmethod
    def setup_routes(cls):
        @PromptServer.instance.routes.get("/ycnode/get_canvas_data/{node_id}")
        async def get_canvas_data(request):
            try:
                node_id = request.match_info["node_id"]
                print(f"Received request for node: {node_id}")
                
                cache_data = cls._canvas_cache
                print(f"Cache content: {cache_data}")
                print(f"Image in cache: {cache_data['image'] is not None}")
                
                response_data = {
                    'success': True,
                    'data': {
                        'image': None,
                        'mask': None
                    }
                }
                
                if cache_data['image'] is not None:
                    pil_image = cache_data['image']
                    buffered = io.BytesIO()
                    pil_image.save(buffered, format="PNG")
                    img_str = base64.b64encode(buffered.getvalue()).decode()
                    response_data['data']['image'] = f"data:image/png;base64,{img_str}"
                
                if cache_data['mask'] is not None:
                    pil_mask = cache_data['mask']
                    mask_buffer = io.BytesIO()
                    pil_mask.save(mask_buffer, format="PNG")
                    mask_str = base64.b64encode(mask_buffer.getvalue()).decode()
                    response_data['data']['mask'] = f"data:image/png;base64,{mask_str}"
                
                return web.json_response(response_data)
                    
            except Exception as e:
                print(f"Error in get_canvas_data: {str(e)}")
                return web.json_response({
                    'success': False,
                    'error': str(e)
                })

    def store_image(self, image_data):
        # 将base64数据转换为PIL Image并存储
        if isinstance(image_data, str) and image_data.startswith('data:image'):
            image_data = image_data.split(',')[1]
            image_bytes = base64.b64decode(image_data)
            self.cached_image = Image.open(io.BytesIO(image_bytes))
        else:
            self.cached_image = image_data
            
    def get_cached_image(self):
        # 将PIL Image转换为base64
        if self.cached_image:
            buffered = io.BytesIO()
            self.cached_image.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode()
            return f"data:image/png;base64,{img_str}"
        return None

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
        
        # 取BiRefNet实例
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
