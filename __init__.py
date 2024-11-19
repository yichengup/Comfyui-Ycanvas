from .canvas_node import CanvasView

NODE_CLASS_MAPPINGS = {
    "CanvasView": CanvasView
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CanvasView": "Canvas View"
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"] 