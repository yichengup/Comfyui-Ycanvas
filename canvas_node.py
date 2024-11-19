from PIL import Image, ImageOps
import hashlib
import torch
import numpy as np
import folder_paths
from server import PromptServer

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
            # 读取保存的画布图像和遮罩
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
            # 返回白色图像和空白遮罩
            blank = np.ones((512, 512, 3), dtype=np.float32)
            blank_mask = np.zeros((512, 512), dtype=np.float32)
            return (torch.from_numpy(blank)[None,], torch.from_numpy(blank_mask)[None,])