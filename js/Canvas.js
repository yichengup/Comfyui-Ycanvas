// 导入套索工具类和新的模块
import { LassoTool } from "./LassoTool.js";
import { PenTool } from "./PenTool.js";
import { CanvasUtils } from "./CanvasUtils.js";
import { CanvasBlendMode } from "./CanvasBlendMode.js";

export class Canvas {
    constructor(node, widget) {
        this.node = node;
        this.widget = widget;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = 512;
        this.height = 512;
        this.layers = [];
        this.selectedLayer = null;
        this.isRotating = false;
        this.rotationStartAngle = 0;
        this.rotationCenter = { x: 0, y: 0 };
        this.selectedLayers = [];
        this.isCtrlPressed = false;
        this.isShiftPressed = false;
        
        // 添加等比例缩放开关
        this.proportionalScaling = false; // 默认关闭等比例缩放
        
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', {
            alpha: false
        });
        this.gridCache = document.createElement('canvas');
        this.gridCacheCtx = this.gridCache.getContext('2d', {
            alpha: false
        });
        
        this.renderAnimationFrame = null;
        this.lastRenderTime = 0;
        this.renderInterval = 1000 / 60;
        this.isDirty = false;
        
        this.dataInitialized = false;
        this.pendingDataCheck = null;
        
        // 添加新的控制状态
        this.activeControlPoint = null;
        this.transformOrigin = { x: 0, y: 0 };
        this.isTransforming = false;
        this.transformType = null; // 'scale', 'rotate', 'skew', 'move'
        this.originalTransform = null;
        
        // 使用LassoTool类替换原有的套索工具实现
        this.lassoTool = new LassoTool(this);
        
        // 添加钢笔工具支持
        this.penTool = new PenTool(this);
        
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        
        // 初始化临时画布
        this.tempCanvas.width = this.width;
        this.tempCanvas.height = this.height;
        
        // 移除工具栏创建代码 - 这些由Canvas_view.js管理
        // 只保留混合模式相关的属性
        this.selectedBlendMode = null;
        this.blendOpacity = 100;
        this.isAdjustingOpacity = false;
        
        // 添加不透明度属性
        this.layers = this.layers.map(layer => ({
            ...layer,
            opacity: 1 // 默认不透明度为 1
        }));

        // 监听图层选择变化，更新套索工具状态
        this.onSelectedLayerChange = () => {
            if (this.lassoTool) {
                this.lassoTool.checkLayerChange();
            }
        };
        
        // 初始化画布和事件
        this.initCanvas();
        this.setupEventListeners();
    }

    initCanvas() {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.border = '1px solid black';
        this.canvas.style.maxWidth = '100%';
        this.canvas.style.backgroundColor = '#606060';
        
        // 移除DOM创建代码 - 画布DOM结构由Canvas_view.js管理
        // 这里只设置画布基本属性
    }

    setupEventListeners() {
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        let isRotating = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let originalTransform = null;
        let lastMoveTime = 0;
        const moveThrottle = 16; // 约60fps
        
        // 键盘事件监听
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = true;
            }
            if (e.key === 'Shift') {
                this.isShiftPressed = true;
            }
            
            if (this.selectedLayer) {
                const step = e.shiftKey ? 1 : 5;
                switch(e.key) {
                    case 'Delete':
                        const index = this.layers.indexOf(this.selectedLayer);
                        this.removeLayer(index);
                        break;
                    case 'ArrowLeft':
                        this.selectedLayers.forEach(layer => layer.x -= step);
                        break;
                    case 'ArrowRight':
                        this.selectedLayers.forEach(layer => layer.x += step);
                        break;
                    case 'ArrowUp':
                        this.selectedLayers.forEach(layer => layer.y -= step);
                        break;
                    case 'ArrowDown':
                        this.selectedLayers.forEach(layer => layer.y += step);
                        break;
                    case 'Escape':
                        // 按ESC键关闭套索工具
                        if (this.lassoTool && this.lassoTool.isActive) {
                            this.lassoButton.style.background = '#3a3a3a';
                            this.lassoModeSelect.style.display = 'none';
                            this.lassoTool.toggle(false);
                            this.updateCursor();
                        }
                        break;
                }
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    this.render();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = false;
            }
            if (e.key === 'Shift') {
                this.isShiftPressed = false;
            }
        });

        // 鼠标按下事件
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.width / rect.width;
            const scaleY = this.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;

            // 处理套索工具
            if (this.lassoTool && this.lassoTool.isActive) {
                // 确保套索工具的目标图层与当前选中图层一致
                if (this.lassoTool.targetLayer !== this.selectedLayer) {
                    this.lassoTool.targetLayer = this.selectedLayer;
                }
                
                // 确保目标图层有效
                if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image) {
                    this.lassoTool.startDrawing(mouseX, mouseY);
                } else {
                    console.log("无效的目标图层，无法使用套索工具");
                    this.lassoTool.toggle(false);
                }
                return;
            }

            // 处理钢笔工具 - 添加优先处理，防止图层选择干扰
            if (this.penTool && this.penTool.isActive) {
                // 确保钢笔工具有锁定的图层
                if (this.penTool.lockedLayer && this.penTool.lockedLayer.image) {
                    // 钢笔工具已经有自己的鼠标处理逻辑，直接返回避免图层选择
                    console.log('🖊️ Canvas mousedown blocked by pen tool');
                    return;
                } else {
                    console.log("钢笔工具缺少锁定图层，自动关闭");
                    this.penTool.deactivate();
                }
            }

            // 首先检查是否点击了控制点
            if (this.selectedLayer) {
                const controlPoint = this.getControlPoint(mouseX, mouseY);
                if (controlPoint) {
                    this.activeControlPoint = controlPoint;
                    this.isTransforming = true;
                    dragStartX = mouseX;
                    dragStartY = mouseY;
                    originalTransform = {
                        x: this.selectedLayer.x,
                        y: this.selectedLayer.y,
                        width: this.selectedLayer.width,
                        height: this.selectedLayer.height,
                        rotation: this.selectedLayer.rotation || 0
                    };
                    e.preventDefault();
                    return;
                }
            }

            // 检查图层点击
            const result = this.getLayerAtPosition(mouseX, mouseY);
            if (result) {
                const clickedLayer = result.layer;
                
                // 处理图层选择
                if (this.isCtrlPressed) {
                    const index = this.selectedLayers.indexOf(clickedLayer);
                    if (index === -1) {
                        this.selectedLayers.push(clickedLayer);
                        this.setSelectedLayer(clickedLayer);
                    } else {
                        this.selectedLayers.splice(index, 1);
                        this.setSelectedLayer(this.selectedLayers[this.selectedLayers.length - 1] || null);
                    }
                } else {
                    if (!this.selectedLayers.includes(clickedLayer)) {
                        this.setSelectedLayer(clickedLayer);
                    }
                }

                isDragging = true;
                lastX = mouseX;
                lastY = mouseY;
                dragStartX = mouseX;
                dragStartY = mouseY;

                if (this.selectedLayer) {
                    originalTransform = {
                        x: this.selectedLayer.x,
                        y: this.selectedLayer.y,
                        width: this.selectedLayer.width,
                        height: this.selectedLayer.height,
                        rotation: this.selectedLayer.rotation || 0
                    };
                }
            } else if (!this.isCtrlPressed) {
                this.setSelectedLayer(null);
            }

            this.render();
        });

        // 鼠标移动事件 - 添加节流优化
        this.canvas.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (now - lastMoveTime < moveThrottle && !this.lassoTool.isDrawing) {
                return; // 跳过过于频繁的移动事件，但套索绘制除外
            }
            lastMoveTime = now;
            
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.width / rect.width;
            const scaleY = this.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;

            // 处理套索工具绘制
            if (this.lassoTool && this.lassoTool.isActive && this.lassoTool.isDrawing) {
                if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image) {
                    this.lassoTool.continueDrawing(mouseX, mouseY);
                } else {
                    // 如果目标图层变为无效，取消绘制
                    this.lassoTool.isDrawing = false;
                    this.lassoTool.toggle(false);
                }
                return;
            }

            // 处理钢笔工具 - 添加优先处理，避免干扰绘制
            if (this.penTool && this.penTool.isActive) {
                // 钢笔工具有自己的鼠标移动处理逻辑，直接返回
                console.log('🖊️ Canvas mousemove blocked by pen tool');
                return;
            }

            // 处理变换操作
            if (this.isTransforming && this.activeControlPoint && originalTransform) {
                const dx = mouseX - dragStartX;
                const dy = mouseY - dragStartY;

                switch (this.activeControlPoint.type) {
                    case 'nw':
                    case 'ne':
                    case 'sw':
                    case 'se':
                        this.handleCornerTransform(this.activeControlPoint.type, dx, dy, originalTransform);
                        break;
                    case 'n':
                    case 's':
                    case 'w':
                    case 'e':
                        this.handleEdgeTransform(this.activeControlPoint.type, dx, dy, originalTransform);
                        break;
                    case 'rotate':
                        this.handleRotation(mouseX, mouseY);
                        break;
                    case 'center':
                        this.handleMove(dx, dy);
                        break;
                }
                this.render();
                return;
            }

            // 处理拖动操作
            if (isDragging && this.selectedLayer) {
                const dx = mouseX - lastX;
                const dy = mouseY - lastY;

                this.selectedLayers.forEach(layer => {
                    layer.x += dx;
                    layer.y += dy;
                });

                lastX = mouseX;
                lastY = mouseY;
                this.render();
            }

            // 更新鼠标样式
            this.updateCursor(mouseX, mouseY);
        });

        // 鼠标释放事件
        this.canvas.addEventListener('mouseup', () => {
            if (this.lassoTool && this.lassoTool.isActive && this.lassoTool.isDrawing) {
                if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image) {
                    this.lassoTool.endDrawing();
                } else {
                    this.lassoTool.isDrawing = false;
                    this.lassoTool.toggle(false);
                }
                return;
            }

            // 处理钢笔工具 - 添加优先处理
            if (this.penTool && this.penTool.isActive) {
                // 钢笔工具有自己的鼠标释放处理逻辑，直接返回
                console.log('🖊️ Canvas mouseup blocked by pen tool');
                return;
            }

            this.isTransforming = false;
            this.activeControlPoint = null;
            isDragging = false;
            isRotating = false;
            originalTransform = null;
        });

        // 鼠标离开事件
        this.canvas.addEventListener('mouseleave', () => {
            // 如果正在使用套索工具绘制，则结束绘制并应用遮罩
            if (this.lassoTool && this.lassoTool.isActive && this.lassoTool.isDrawing) {
                if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image && this.lassoTool.points.length > 2) {
                    // 只结束当前绘制，但不合并遮罩
                    this.lassoTool.endDrawing();
                } else {
                    this.lassoTool.isDrawing = false;
                    // 不自动关闭套索工具，只是取消当前绘制
                    this.lassoTool.clearPath();
                }
            }
            
            // 处理钢笔工具 - 鼠标离开时不重置状态，让钢笔工具自己处理
            if (this.penTool && this.penTool.isActive) {
                console.log('🖊️ Canvas mouseleave - pen tool keeps state');
                return;
            }
            
            isDragging = false;
            isRotating = false;
            this.isTransforming = false;
            this.activeControlPoint = null;
        });

        // 滚轮事件
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.selectedLayer) return;
            
            // 处理钢笔工具 - 添加保护，防止滚轮影响图层
            if (this.penTool && this.penTool.isActive) {
                // 钢笔工具激活时，禁用滚轮缩放/旋转图层
                console.log('🖊️ Canvas wheel blocked by pen tool');
                e.preventDefault();
                return;
            }
            
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.width / rect.width;
            const scaleY = this.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;
            
            if (e.shiftKey) {
                // 旋转
                const rotateAngle = e.deltaY > 0 ? -5 : 5;
                this.selectedLayers.forEach(layer => {
                    layer.rotation = (layer.rotation || 0) + rotateAngle;
                });
            } else {
                // 缩放
                const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
                this.selectedLayers.forEach(layer => {
                    const oldWidth = layer.width;
                    const oldHeight = layer.height;
                    layer.width *= scaleFactor;
                    layer.height *= scaleFactor;
                    layer.x += (oldWidth - layer.width) / 2;
                    layer.y += (oldHeight - layer.height) / 2;
                });
            }
            
            this.render();
        });
    }

    getControlPoint(x, y) {
        if (!this.selectedLayer) return null;
        
        const layer = this.selectedLayer;
        const centerX = layer.x + layer.width/2;
        const centerY = layer.y + layer.height/2;
        
        // 将鼠标坐标转换到图层的本地坐标系
        let localX = x - centerX;
        let localY = y - centerY;
        
        // 如果图层有旋转，需要反向旋转坐标
        if (layer.rotation) {
            const rad = -layer.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const tempX = localX;
            localX = tempX * cos - localY * sin;
            localY = tempX * sin + localY * cos;
        }
        
        // 控制点位置（相对于图层中心）
        const halfWidth = layer.width/2;
        const halfHeight = layer.height/2;
        const points = [
            { x: -halfWidth, y: -halfHeight, type: 'nw' },
            { x: halfWidth, y: -halfHeight, type: 'ne' },
            { x: -halfWidth, y: halfHeight, type: 'sw' },
            { x: halfWidth, y: halfHeight, type: 'se' },
            { x: 0, y: -halfHeight, type: 'n' },
            { x: 0, y: halfHeight, type: 's' },
            { x: -halfWidth, y: 0, type: 'w' },
            { x: halfWidth, y: 0, type: 'e' },
            { x: 0, y: 0, type: 'center' },
            { x: 0, y: -halfHeight - 30, type: 'rotate' }
        ];
        
        // 检查是否点击到控制点
        const hitRadius = 8;
        for (const point of points) {
            const dx = localX - point.x;
            const dy = localY - point.y;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                return point;
            }
        }
        
        return null;
    }

    isRotationHandle(x, y) {
        if (!this.selectedLayer) return false;
        
        // 获取画布缩放比例
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        
        // 转换坐标到实际画布坐标系
        const canvasX = x * scaleX;
        const canvasY = y * scaleY;
        
        const handleX = this.selectedLayer.x + this.selectedLayer.width/2;
        const handleY = this.selectedLayer.y - 30;
        const handleRadius = 5 * Math.max(scaleX, scaleY);
        
        return Math.sqrt(Math.pow(canvasX - handleX, 2) + Math.pow(canvasY - handleY, 2)) <= handleRadius;
    }

    addLayer(image) {
        if (!image) return null;
        
        // 计算居中位置
        const scale = Math.min(
            this.width / image.width * 0.8,
            this.height / image.height * 0.8
        );
        
        const layer = {
            image: image,
            x: (this.width - image.width * scale) / 2,
            y: (this.height - image.height * scale) / 2,
            width: image.width * scale,
            height: image.height * scale,
            rotation: 0,
            zIndex: this.layers.length,
            opacity: 1
        };
        
        this.layers.push(layer);
        this.setSelectedLayer(layer);
        this.render();
        return layer;
    }

    removeLayer(index) {
        if (index >= 0 && index < this.layers.length) {
            const removedLayer = this.layers[index];
            this.layers.splice(index, 1);
            
            // 更新 zIndex
            this.layers.forEach((layer, i) => {
                layer.zIndex = i;
            });
            
            // 如果删除的是当前选中的图层，选择其他图层或清空选择
            if (this.selectedLayer === removedLayer) {
                this.setSelectedLayer(this.layers[0] || null);
            }
            
            this.render();
        }
        this.cleanupLayers();
    }

    moveLayer(fromIndex, toIndex) {
        if (fromIndex >= 0 && fromIndex < this.layers.length &&
            toIndex >= 0 && toIndex < this.layers.length) {
            const layer = this.layers.splice(fromIndex, 1)[0];
            this.layers.splice(toIndex, 0, layer);
            this.render();
        }
    }

    resizeLayer(scale) {
        this.selectedLayers.forEach(layer => {
            // 更新图层尺寸
            layer.width *= scale;
            layer.height *= scale;
            
            // 如果仍有旧版mask属性，处理它们
            if (layer.mask) {
                const oldWidth = layer.width / scale;
                const oldHeight = layer.height / scale;
                const oldMask = layer.mask;
                const oldMaskLength = oldMask.length;
                const newMaskLength = Math.round(layer.width * layer.height);
                
                // 创建新的遮罩数组
                const newMask = new Float32Array(newMaskLength);
                
                // 使用双线性插值来缩放遮罩数据
                const oldMaskWidth = oldWidth;
                const oldMaskHeight = oldHeight;
                const newMaskWidth = layer.width;
                const newMaskHeight = layer.height;
                
                for (let y = 0; y < newMaskHeight; y++) {
                    for (let x = 0; x < newMaskWidth; x++) {
                        // 计算在旧遮罩中的对应坐标
                        const oldX = (x / newMaskWidth) * oldMaskWidth;
                        const oldY = (y / newMaskHeight) * oldMaskHeight;
                        
                        // 计算四个最近的像素坐标
                        const x1 = Math.floor(oldX);
                        const y1 = Math.floor(oldY);
                        const x2 = Math.min(x1 + 1, oldMaskWidth - 1);
                        const y2 = Math.min(y1 + 1, oldMaskHeight - 1);
                        
                        // 计算权重
                        const wx = oldX - x1;
                        const wy = oldY - y1;
                        
                        // 获取四个最近的像素
                        const p11 = oldMask[y1 * oldMaskWidth + x1] || 0;
                        const p12 = oldMask[y1 * oldMaskWidth + x2] || 0;
                        const p21 = oldMask[y2 * oldMaskWidth + x1] || 0;
                        const p22 = oldMask[y2 * oldMaskWidth + x2] || 0;
                        
                        // 进行双线性插值
                        const topInterp = p11 * (1 - wx) + p12 * wx;
                        const bottomInterp = p21 * (1 - wx) + p22 * wx;
                        const value = topInterp * (1 - wy) + bottomInterp * wy;
                        
                        // 存储到新的遮罩数组
                        newMask[y * Math.round(newMaskWidth) + x] = value;
                    }
                }
                
                // 更新图层的遮罩
                layer.mask = newMask;
                
                // 更新遮罩画布
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = layer.width;
                maskCanvas.height = layer.height;
                const ctx = maskCanvas.getContext('2d');
                
                // 将Float32Array转换为ImageData
                const imageData = ctx.createImageData(layer.width, layer.height);
                for (let i = 0; i < newMask.length; i++) {
                    const index = i * 4;
                    const alpha = Math.round(newMask[i] * 255);
                    imageData.data[index] = 255;
                    imageData.data[index + 1] = 255;
                    imageData.data[index + 2] = 255;
                    imageData.data[index + 3] = alpha;
                }
                
                ctx.putImageData(imageData, 0, 0);
                layer.maskCanvas = maskCanvas;
            }
        });
        this.render();
    }

    rotateLayer(angle) {
        this.selectedLayers.forEach(layer => {
            layer.rotation += angle;
        });
        this.render();
    }

    updateCanvasSize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        
        // 同时更新离屏画布的大小
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;
        
        // 同时更新套索工具和钢笔工具的画布大小
        if (this.lassoTool) {
            this.lassoTool.updateCanvasSize(width, height);
        }
        
        if (this.penTool) {
            this.penTool.updateCanvasSize(width, height);
        }
        
        // 新增：检查并重新定位超出边界的图层
        this.adjustLayersForNewCanvasSize(width, height);
        
        this.render();
    }
    
    // 新增：调整图层以适应新的画布尺寸
    adjustLayersForNewCanvasSize(newWidth, newHeight) {
        if (this.layers.length === 0) return;
        
        console.log(`Adjusting ${this.layers.length} layers for new canvas size: ${newWidth}x${newHeight}`);
        
        // 遍历所有图层，检查是否需要调整
        this.layers.forEach((layer, index) => {
            if (!layer || !layer.image) return;
            
            // 检查图层是否超出新画布边界
            const isOutOfBounds = (
                layer.x < 0 || 
                layer.y < 0 || 
                layer.x + layer.width > newWidth || 
                layer.y + layer.height > newHeight
            );
            
            // 检查图层是否太大，无法完全适应新画布
            const isTooBig = (
                layer.width > newWidth * 0.9 || 
                layer.height > newHeight * 0.9
            );
            
            if (isOutOfBounds || isTooBig) {
                console.log(`Adjusting layer ${index}: outOfBounds=${isOutOfBounds}, tooBig=${isTooBig}`);
                
                // 重新计算缩放比例，使图层适应新画布
                const scale = Math.min(
                    newWidth / layer.image.width * 0.8,
                    newHeight / layer.image.height * 0.8,
                    1 // 不要放大，只缩小
                );
                
                // 应用新的尺寸和位置
                layer.width = layer.image.width * scale;
                layer.height = layer.image.height * scale;
                layer.x = (newWidth - layer.width) / 2;
                layer.y = (newHeight - layer.height) / 2;
                
                // 如果图层有遮罩，也需要相应调整
                if (layer.mask) {
                    this.updateLayerMask(layer);
                }
                
                console.log(`Layer ${index} adjusted: new size=${layer.width}x${layer.height}, new position=(${layer.x}, ${layer.y})`);
            }
        });
        
        // 如果当前有选中的图层且被调整了，确保它仍然是选中状态
        if (this.selectedLayer && this.layers.includes(this.selectedLayer)) {
            // 重新设置选中状态以触发UI更新
            const currentSelected = this.selectedLayer;
            this.setSelectedLayer(currentSelected);
        }
    }

    render() {
        // 标记为脏
        this.isDirty = true;
        
        // 如果已经有渲染帧请求，则不重复请求
        if (this.renderAnimationFrame) return;
        
        // 请求在下一帧渲染
        this.renderAnimationFrame = requestAnimationFrame(() => {
            this.actualRender();
            this.renderAnimationFrame = null;
        });
    }

    actualRender() {
        if (!this.isDirty) return;
        this.isDirty = false;
        
        // 清空画布
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        // 绘制背景网格
        this.drawCachedGrid();
        
        // 按照 zIndex 排序图层
        const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);
        
        // 使用离屏渲染优化大尺寸画布性能
        const useOffscreenRendering = this.width * this.height > 1000000;
        let offscreenCanvas, offscreenCtx;
        
        if (useOffscreenRendering) {
            offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = this.width;
            offscreenCanvas.height = this.height;
            offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true });
        }
        
        // 绘制所有图层
        for (const layer of sortedLayers) {
            // 跳过无效图层
            if (!layer || !layer.image) continue;
            
            // 创建临时画布用于图层合成
            const layerCanvas = document.createElement('canvas');
            layerCanvas.width = this.width;
            layerCanvas.height = this.height;
            const layerCtx = layerCanvas.getContext('2d', { alpha: true });
            
            // 保存上下文状态
            layerCtx.save();
            
            // 设置图层中心点
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            
            // 应用变换
            layerCtx.translate(centerX, centerY);
            if (layer.rotation) {
                layerCtx.rotate(layer.rotation * Math.PI / 180);
            }
            
            // 绘制图层 - 图像本身可能已经包含Alpha通道
            layerCtx.drawImage(
                layer.image,
                -layer.width/2,
                -layer.height/2,
                layer.width,
                layer.height
            );
            
            // 如果图层仍然有单独的遮罩（旧数据兼容），应用遮罩
            if (layer.mask) {
                // 确保遮罩画布存在且最新
                if (!layer.maskCanvas) {
                    this.updateLayerMask(layer);
                }
                
                // 在临时画布上应用遮罩
                layerCtx.globalCompositeOperation = 'destination-in';
                layerCtx.drawImage(
                    layer.maskCanvas,
                    -layer.width/2,
                    -layer.height/2,
                    layer.width,
                    layer.height
                );
            }
            
            // 恢复上下文状态
            layerCtx.restore();
            
            // 将合成后的图层绘制到主画布或离屏画布上
            const targetCtx = useOffscreenRendering ? offscreenCtx : this.ctx;
            targetCtx.save();
            
            // 应用不透明度
            if (layer.opacity !== undefined) {
                targetCtx.globalAlpha = layer.opacity;
            }
            
            // 应用混合模式
            if (layer.blendMode && layer.blendMode !== 'normal') {
                targetCtx.globalCompositeOperation = layer.blendMode;
            }
            
            // 将合成后的图层绘制到目标画布
            targetCtx.drawImage(layerCanvas, 0, 0);
            targetCtx.restore();
        }
        
        // 如果使用了离屏渲染，将结果绘制到主画布
        if (useOffscreenRendering) {
            this.ctx.drawImage(offscreenCanvas, 0, 0);
        }
        
        // 绘制选中图层的边框和控制点
        if (this.selectedLayer && this.selectedLayer.image) {
            this.drawSelectionFrame(this.selectedLayer, this.ctx);
        }
        
        // 显示套索工具的临时画布（如果激活）
        if (this.lassoTool && this.lassoTool.isActive && this.lassoTool.getTempCanvas()) {
            // 只有当套索工具激活且目标图层存在时才显示临时画布
            if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image) {
                this.ctx.drawImage(this.lassoTool.getTempCanvas(), 0, 0);
            } else {
                // 如果目标图层无效，自动关闭套索工具
                this.lassoTool.toggle(false);
            }
        }
        
        // 显示钢笔工具的临时画布（如果激活）
        if (this.penTool && this.penTool.isActive && this.penTool.getTempCanvas()) {
            // 只有当钢笔工具激活且锁定图层存在时才显示临时画布
            if (this.penTool.lockedLayer && this.penTool.lockedLayer.image) {
                this.ctx.drawImage(this.penTool.getTempCanvas(), 0, 0);
            }
        }
    }

    drawCachedGrid() {
        if (this.gridCache.width !== this.width || 
            this.gridCache.height !== this.height) {
            this.gridCache.width = this.width;
            this.gridCache.height = this.height;
            
            const ctx = this.gridCacheCtx;
            const gridSize = 20;
            
            ctx.beginPath();
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 0.5;
            
            for(let y = 0; y < this.height; y += gridSize) {
                ctx.moveTo(0, y);
                ctx.lineTo(this.width, y);
            }
            
            for(let x = 0; x < this.width; x += gridSize) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.height);
            }
            
            ctx.stroke();
        }
        
        this.offscreenCtx.drawImage(this.gridCache, 0, 0);
    }

    drawSelectionFrame(layer, ctx) {
        if (!layer || !layer.image) return;
        
        ctx.save();
        
        // 设置选择框样式
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        const centerX = layer.x + layer.width/2;
        const centerY = layer.y + layer.height/2;
        
        // 重置变换矩阵
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // 移动到旋转中心
        ctx.translate(centerX, centerY);
        
        // 应用旋转
        if (layer.rotation) {
            ctx.rotate(layer.rotation * Math.PI / 180);
        }
        
        // 绘制选择框
        ctx.strokeRect(
            -layer.width/2,
            -layer.height/2,
            layer.width,
            layer.height
        );
        
        // 绘制控制点
        this.drawControlPoints(layer, ctx);
        
        // 绘制旋转控制线和手柄
        ctx.beginPath();
        ctx.moveTo(0, -layer.height/2);
        ctx.lineTo(0, -layer.height/2 - 30);
        ctx.stroke();
        
        ctx.restore();
    }

    drawControlPoints(layer, ctx) {
        if (!layer || !layer.image) return;
        
        const halfWidth = layer.width/2;
        const halfHeight = layer.height/2;
        
        // 控制点位置（相对于图层中心）
        const points = [
            { x: -halfWidth, y: -halfHeight, type: 'nw' },
            { x: halfWidth, y: -halfHeight, type: 'ne' },
            { x: -halfWidth, y: halfHeight, type: 'sw' },
            { x: halfWidth, y: halfHeight, type: 'se' },
            { x: 0, y: -halfHeight, type: 'n' },
            { x: 0, y: halfHeight, type: 's' },
            { x: -halfWidth, y: 0, type: 'w' },
            { x: halfWidth, y: 0, type: 'e' },
            { x: 0, y: 0, type: 'center' },
            { x: 0, y: -halfHeight - 30, type: 'rotate' }
        ];
        
        // 设置控制点样式
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        
        // 绘制所有控制点
        points.forEach(point => {
            // 在等比例模式下，边缘控制点变为灰色并禁用
            const isEdgePoint = ['n', 's', 'w', 'e'].includes(point.type);
            const isCornerPoint = ['nw', 'ne', 'sw', 'se'].includes(point.type);
            
            if (this.proportionalScaling) {
                if (isEdgePoint) {
                    // 边缘控制点在等比例模式下显示为灰色（禁用状态）
                    ctx.fillStyle = '#666666';
                    ctx.strokeStyle = '#888888';
                } else if (isCornerPoint) {
                    // 角点在等比例模式下显示为蓝色（等比例缩放）
                    ctx.fillStyle = '#4a8cff';
                    ctx.strokeStyle = '#ffffff';
                } else if (point.type === 'center') {
                    ctx.fillStyle = '#ffff00';
                    ctx.strokeStyle = '#ffffff';
                } else if (point.type === 'rotate') {
                    ctx.fillStyle = '#00ffff';
                    ctx.strokeStyle = '#ffffff';
                }
            } else {
                // 自由拉伸模式下的原有颜色
            ctx.fillStyle = point.type === 'center' ? '#ffff00' : 
                          point.type === 'rotate' ? '#00ffff' : '#00ff00';
            ctx.strokeStyle = '#ffffff';
            }
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // 在等比例模式下，为角点添加小图标指示
            if (this.proportionalScaling && isCornerPoint) {
                ctx.fillStyle = '#ffffff';
                ctx.font = '8px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('⚏', point.x, point.y + 2);
            }
        });
    }

    updateCursor(x, y) {
        if (this.lassoTool.isActive) {
            // 确保套索工具有有效的目标图层
            if (this.lassoTool.targetLayer && this.lassoTool.targetLayer.image) {
                this.canvas.style.cursor = 'crosshair';
                return;
            } else {
                // 如果目标图层无效，自动关闭套索工具
                this.lassoTool.toggle(false);
            }
        }

        // 处理钢笔工具 - 添加优先处理
        if (this.penTool && this.penTool.isActive) {
            // 钢笔工具有自己的光标管理，交给钢笔工具处理
            // 钢笔工具在activate方法中已设置crosshair光标
            return;
        }

        if (this.selectedLayer) {
            // 获取鼠标位置可能点击的控制点
            const controlPoint = this.getControlPoint(x, y);
            
            if (controlPoint) {
                // 在等比例模式下，边缘控制点显示禁用光标
                const isEdgePoint = ['n', 's', 'w', 'e'].includes(controlPoint.type);
                if (this.proportionalScaling && isEdgePoint) {
                    this.canvas.style.cursor = 'not-allowed';
                    return;
                }
                
                // 设置不同控制点的光标
                switch (controlPoint.type) {
                    case 'nw':
                    case 'se':
                        this.canvas.style.cursor = this.proportionalScaling ? 'nwse-resize' : 'nwse-resize';
                        break;
                    case 'ne':
                    case 'sw':
                        this.canvas.style.cursor = this.proportionalScaling ? 'nesw-resize' : 'nesw-resize';
                        break;
                    case 'n':
                    case 's':
                        this.canvas.style.cursor = this.proportionalScaling ? 'not-allowed' : 'ns-resize';
                        break;
                    case 'e':
                    case 'w':
                        this.canvas.style.cursor = this.proportionalScaling ? 'not-allowed' : 'ew-resize';
                        break;
                    case 'rotate':
                        this.canvas.style.cursor = 'grab';
                        break;
                    case 'center':
                        this.canvas.style.cursor = 'move';
                        break;
                }
                return;
            }

            // 检查是否悬停在图层上
            const hoveredLayer = this.getLayerAtPosition(x, y);
            if (hoveredLayer) {
                this.canvas.style.cursor = 'move';
                return;
            }
        }

        // 默认光标
        this.canvas.style.cursor = 'default';
    }

    async saveToServer(fileName) {
        return await CanvasUtils.saveToServer(this, fileName);
    }

    moveLayerUp() {
        if (!this.selectedLayer) return;
        const index = this.layers.indexOf(this.selectedLayer);
        if (index < this.layers.length - 1) {
            const temp = this.layers[index].zIndex;
            this.layers[index].zIndex = this.layers[index + 1].zIndex;
            this.layers[index + 1].zIndex = temp;
            [this.layers[index], this.layers[index + 1]] = [this.layers[index + 1], this.layers[index]];
            this.render();
        }
    }

    moveLayerDown() {
        if (!this.selectedLayer) return;
        const index = this.layers.indexOf(this.selectedLayer);
        if (index > 0) {
            const temp = this.layers[index].zIndex;
            this.layers[index].zIndex = this.layers[index - 1].zIndex;
            this.layers[index - 1].zIndex = temp;
            [this.layers[index], this.layers[index - 1]] = [this.layers[index - 1], this.layers[index]];
            this.render();
        }
    }

    getLayerAtPosition(x, y) {
        // 从上层到下层遍历所有图层
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            
            // 计算旋转后的点击位置
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            let transformedX = x;
            let transformedY = y;
            
            if (layer.rotation) {
                const rad = -layer.rotation * Math.PI / 180;
                const dx = x - centerX;
                const dy = y - centerY;
                transformedX = dx * Math.cos(rad) - dy * Math.sin(rad) + centerX;
                transformedY = dx * Math.sin(rad) + dy * Math.cos(rad) + centerY;
            }
            
            // 检查点击位置是否在图层范围内
            if (transformedX >= layer.x && 
                transformedX <= layer.x + layer.width &&
                transformedY >= layer.y && 
                transformedY <= layer.y + layer.height) {
                
                // 检查透明度
                const localX = Math.floor((transformedX - layer.x) * (layer.image.width / layer.width));
                const localY = Math.floor((transformedY - layer.y) * (layer.image.height / layer.height));
                
                // 创建临时画布检查像素透明度
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.width = layer.image.width;
                tempCanvas.height = layer.image.height;
                
                tempCtx.drawImage(layer.image, 0, 0);
                
                try {
                    const pixel = tempCtx.getImageData(localX, localY, 1, 1).data;
                    if (pixel[3] > 10) { // alpha阈值
                        return {
                            layer: layer,
                            localX: transformedX - layer.x,
                            localY: transformedY - layer.y
                        };
                    }
                } catch(e) {
                    console.error("Error checking pixel transparency:", e);
                }
            }
        }
        return null;
    }

    getResizeHandle(x, y) {
        if (!this.selectedLayer) return null;
        
        const handleRadius = 5;
        const handles = {
            'nw': {x: this.selectedLayer.x, y: this.selectedLayer.y},
            'ne': {x: this.selectedLayer.x + this.selectedLayer.width, y: this.selectedLayer.y},
            'se': {x: this.selectedLayer.x + this.selectedLayer.width, y: this.selectedLayer.y + this.selectedLayer.height},
            'sw': {x: this.selectedLayer.x, y: this.selectedLayer.y + this.selectedLayer.height}
        };

        for (const [position, point] of Object.entries(handles)) {
            if (Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2)) <= handleRadius) {
                return position;
            }
        }
        return null;
    }

    // 修改水平镜像方法
    mirrorHorizontal() {
        if (!this.selectedLayer) return;
        
        // 创建临时画布
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = this.selectedLayer.image.width;
        tempCanvas.height = this.selectedLayer.image.height;
        
        // 水平翻转绘制
        tempCtx.translate(tempCanvas.width, 0);
        tempCtx.scale(-1, 1);
        tempCtx.drawImage(this.selectedLayer.image, 0, 0);
        
        // 创建新图像
        const newImage = new Image();
        newImage.onload = () => {
            this.selectedLayer.image = newImage;
            this.render();
        };
        newImage.src = tempCanvas.toDataURL();
    }

    // 修改垂直镜像方法
    mirrorVertical() {
        if (!this.selectedLayer) return;
        
        // 创建临时画布
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = this.selectedLayer.image.width;
        tempCanvas.height = this.selectedLayer.image.height;
        
        // 垂直翻转绘制
        tempCtx.translate(0, tempCanvas.height);
        tempCtx.scale(1, -1);
        tempCtx.drawImage(this.selectedLayer.image, 0, 0);
        
        // 创建新图像
        const newImage = new Image();
        newImage.onload = () => {
            this.selectedLayer.image = newImage;
            this.render();
        };
        newImage.src = tempCanvas.toDataURL();
    }

    async getLayerImageData(layer) {
        try {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            // 设置画布尺寸
            tempCanvas.width = layer.width;
            tempCanvas.height = layer.height;
            
            // 清除画布
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // 绘制图层
            tempCtx.save();
            tempCtx.translate(layer.width/2, layer.height/2);
            tempCtx.rotate(layer.rotation * Math.PI / 180);
            tempCtx.drawImage(
                layer.image,
                -layer.width/2,
                -layer.height/2,
                layer.width,
                layer.height
            );
            tempCtx.restore();
            
            // 获取base64数据
            const dataUrl = tempCanvas.toDataURL('image/png');
            if (!dataUrl.startsWith('data:image/png;base64,')) {
                throw new Error("Invalid image data format");
            }
            
            return dataUrl;
        } catch (error) {
            console.error("Error getting layer image data:", error);
            throw error;
        }
    }

    // 添加带遮罩的图层
    addMattedLayer(image, mask) {
        const layer = {
            image: image,
            mask: mask,
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
            rotation: 0,
            zIndex: this.layers.length
        };
        
        this.layers.push(layer);
        this.selectedLayer = layer;
        this.render();
    }

    processInputData(nodeData) {
        if (nodeData.input_image) {
            this.addInputImage(nodeData.input_image);
        }
        if (nodeData.input_mask) {
            this.addInputMask(nodeData.input_mask);
        }
    }

    addInputImage(imageData) {
        const layer = new ImageLayer(imageData);
        this.layers.push(layer);
        this.updateCanvas();
    }

    addInputMask(maskData) {
        if (this.inputImage) {
            const mask = new MaskLayer(maskData);
            mask.linkToLayer(this.inputImage);
            this.masks.push(mask);
            this.updateCanvas();
        }
    }

    async addInputToCanvas(inputImage, inputMask) {
        try {
            console.log("Adding input to canvas:", { inputImage });
            
            // 创建临时画布
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = inputImage.width;
            tempCanvas.height = inputImage.height;

            // 将数据绘制到临时画布
            const imgData = new ImageData(
                inputImage.data,
                inputImage.width,
                inputImage.height
            );
            tempCtx.putImageData(imgData, 0, 0);

            // 创建新图像
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = tempCanvas.toDataURL();
            });

            // 计算缩放比例
            const scale = Math.min(
                this.width / inputImage.width * 0.8,
                this.height / inputImage.height * 0.8
            );

            // 创建新图层
            const layer = {
                image: image,
                x: (this.width - inputImage.width * scale) / 2,
                y: (this.height - inputImage.height * scale) / 2,
                width: inputImage.width * scale,
                height: inputImage.height * scale,
                rotation: 0,
                zIndex: this.layers.length
            };

            // 如果有遮罩数据，添加到图层
            if (inputMask) {
                layer.mask = inputMask.data;
            }

            // 添加图层并选中
            this.layers.push(layer);
            this.selectedLayer = layer;
            
            // 渲染画布
            this.render();
            console.log("Layer added successfully");
            
            return true;

        } catch (error) {
            console.error("Error in addInputToCanvas:", error);
            throw error;
        }
    }

    // 使用CanvasUtils模块的工具函数
    async convertTensorToImage(tensor) {
        return await CanvasUtils.convertTensorToImage(tensor);
    }

    async convertTensorToMask(tensor) {
        return await CanvasUtils.convertTensorToMask(tensor);
    }

    convertTensorToImageData(tensor) {
        return CanvasUtils.convertTensorToImageData(tensor);
    }

    async createImageFromData(imageData) {
        return await CanvasUtils.createImageFromData(imageData);
    }

    async loadImageFromCache(base64Data) {
        return await CanvasUtils.loadImageFromCache(base64Data);
    }

    // 使用CanvasBlendMode模块的方法
    showBlendModeMenu(x, y) {
        CanvasBlendMode.showBlendModeMenu(this, x, y);
    }

    handleBlendModeSelection(mode) {
        CanvasBlendMode.handleBlendModeSelection(this, mode);
    }

    showOpacitySlider(mode) {
        CanvasBlendMode.showOpacitySlider(this, mode);
    }

    applyBlendMode(mode, opacity) {
        CanvasBlendMode.applyBlendMode(this, mode, opacity);
    }

    // 处理角点变形
    handleCornerTransform(type, dx, dy, original) {
        const layer = this.selectedLayer;
        const minSize = 20;
        
        if (this.proportionalScaling) {
            // 等比例缩放模式
            const aspectRatio = original.width / original.height;
            
            switch (type) {
                case 'nw':
                case 'se':
                    // 使用对角线方向的拖拽距离计算缩放比例
                    const diagonal = Math.sqrt(dx * dx + dy * dy);
                    const direction = (type === 'nw') ? 
                        ((dx < 0 && dy < 0) ? 1 : -1) : 
                        ((dx > 0 && dy > 0) ? 1 : -1);
                    const scale = 1 + (direction * diagonal) / Math.max(original.width, original.height);
                    
                    layer.width = Math.max(minSize, original.width * scale);
                    layer.height = Math.max(minSize, original.height * scale);
                    
                    if (type === 'nw') {
                        layer.x = original.x + (original.width - layer.width);
                        layer.y = original.y + (original.height - layer.height);
                    }
                    break;
                    
                case 'ne':
                case 'sw':
                    // 使用主要拖拽方向计算缩放
                    const mainDirection = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
                    const scaleNE = 1 + mainDirection / Math.max(original.width, original.height);
                    
                    layer.width = Math.max(minSize, original.width * scaleNE);
                    layer.height = Math.max(minSize, original.height * scaleNE);
                    
                    if (type === 'sw') {
                        layer.x = original.x + (original.width - layer.width);
                    }
                    if (type === 'ne') {
                        layer.y = original.y + (original.height - layer.height);
                    }
                    break;
            }
        } else {
            // 自由拉伸模式（原有逻辑）
        switch (type) {
            case 'nw':
                layer.width = Math.max(minSize, original.width - dx);
                layer.height = Math.max(minSize, original.height - dy);
                layer.x = original.x + (original.width - layer.width);
                layer.y = original.y + (original.height - layer.height);
                break;
            case 'ne':
                layer.width = Math.max(minSize, original.width + dx);
                layer.height = Math.max(minSize, original.height - dy);
                layer.y = original.y + (original.height - layer.height);
                break;
            case 'sw':
                layer.width = Math.max(minSize, original.width - dx);
                layer.height = Math.max(minSize, original.height + dy);
                layer.x = original.x + (original.width - layer.width);
                break;
            case 'se':
                layer.width = Math.max(minSize, original.width + dx);
                layer.height = Math.max(minSize, original.height + dy);
                break;
            }
        }
    }
    
    // 处理边线变形
    handleEdgeTransform(type, dx, dy, original) {
        // 在等比例缩放模式下，边缘拖拽会破坏比例，所以禁用
        if (this.proportionalScaling) {
            return; // 不处理边缘拖拽
        }
        
        const layer = this.selectedLayer;
        const minSize = 20;
        
        switch (type) {
            case 'n':
                layer.height = Math.max(minSize, original.height - dy);
                layer.y = original.y + (original.height - layer.height);
                break;
            case 's':
                layer.height = Math.max(minSize, original.height + dy);
                break;
            case 'w':
                layer.width = Math.max(minSize, original.width - dx);
                layer.x = original.x + (original.width - layer.width);
                break;
            case 'e':
                layer.width = Math.max(minSize, original.width + dx);
                break;
        }
    }
    
    // 处理旋转
    handleRotation(mouseX, mouseY) {
        const layer = this.selectedLayer;
        if (!layer) return;
        
        const centerX = layer.x + layer.width / 2;
        const centerY = layer.y + layer.height / 2;
        
        // 计算旋转角度
        const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
        let rotation = (angle * 180 / Math.PI + 90) % 360;
        
        // 添加Shift键15度角度吸附
        if (this.isShiftPressed) {
            rotation = Math.round(rotation / 15) * 15;
        }
        
        layer.rotation = rotation;
        this.render();
    }
    
    // 处理移动
    handleMove(dx, dy) {
        const layer = this.selectedLayer;
        layer.x += dx;
        layer.y += dy;
    }

    // 更新图层蒙版
    updateLayerMask(layer) {
        if (!layer) return;
        
        const mask = layer.mask;
        
        if (!mask) return;
        
        // 创建蒙版画布
        if (!layer.maskCanvas) {
            layer.maskCanvas = document.createElement('canvas');
        }
        
        layer.maskCanvas.width = layer.width;
        layer.maskCanvas.height = layer.height;
        const ctx = layer.maskCanvas.getContext('2d');
        
        // 创建ImageData
        const imageData = ctx.createImageData(layer.width, layer.height);
        
        // 确保遮罩数据的长度与图层尺寸一致
        if (mask.length !== layer.width * layer.height) {
            console.warn('遮罩数据长度与图层尺寸不匹配，正在调整...');
            const newMask = new Float32Array(layer.width * layer.height);
            // 填充新遮罩为原遮罩的值或0
            for (let i = 0; i < newMask.length; i++) {
                newMask[i] = (i < mask.length) ? mask[i] : 0;
            }
            layer.mask = newMask;
        }
        
        // 将Float32Array转换为ImageData
        for (let i = 0; i < mask.length; i++) {
            const index = i * 4;
            const alpha = Math.round(mask[i] * 255);
            imageData.data[index] = 255;
            imageData.data[index + 1] = 255;
            imageData.data[index + 2] = 255;
            imageData.data[index + 3] = alpha;
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    // 添加方法 - 统一选择图层和清理无效图层
    setSelectedLayer(layer) {
        const previousLayer = this.selectedLayer;
        
        if (!layer || !layer.image) {
            this.selectedLayer = null;
            this.selectedLayers = [];
        } else {
            this.selectedLayer = layer;
            this.selectedLayers = [layer];
        }
        
        // 如果选中的图层变化了，检查并更新套索工具状态
        if (previousLayer !== this.selectedLayer && this.lassoTool) {
            // 如果当前套索工具有活动的绘制，并且有足够的点形成有效遮罩，则先完成当前选择
            if (this.lassoTool.isActive && this.lassoTool.isDrawing && this.lassoTool.points.length > 2) {
                // 结束当前绘制，应用遮罩
                this.lassoTool.endDrawing();
            }
            
            // 如果是切换图层且前一个图层有遮罩，则合并遮罩到图像
            if (this.lassoTool.isActive && previousLayer && previousLayer.mask) {
                this.lassoTool.mergeLayerMask(previousLayer);
            }
            
            // 调用checkLayerChange，这会自动关闭套索工具
            this.lassoTool.checkLayerChange();
        }
        
        this.render();
    }

    cleanupLayers() {
        // 移除无效的图层
        this.layers = this.layers.filter(layer => layer && layer.image);
        
        // 确保 zIndex 是连续的
        this.layers.forEach((layer, index) => {
            layer.zIndex = index;
        });
        
        // 检查选中的图层是否仍然有效
        if (this.selectedLayer && (!this.selectedLayer.image || !this.layers.includes(this.selectedLayer))) {
            this.setSelectedLayer(null);
        }
        
        this.render();
    }

    // 添加居中图层的方法
    centerLayer(layer) {
        if (!layer || !layer.image) return;
        
        const scale = Math.min(
            this.width / layer.image.width * 0.8,
            this.height / layer.image.height * 0.8
        );
        
        layer.width = layer.image.width * scale;
        layer.height = layer.image.height * scale;
        layer.x = (this.width - layer.width) / 2;
        layer.y = (this.height - layer.height) / 2;
        
        this.render();
    }

    // 导入缓存图像方法
    async importImage(cacheData) {
        try {
            console.log("Starting image import with cache data:", cacheData);
            
            // 检查缓存数据格式
            if (!cacheData || !cacheData.image) {
                throw new Error("No image data in cache");
            }
            
            // 直接尝试使用缓存数据
            // 假设服务器已经将PIL图像转换为适当的格式
            let imgSrc = cacheData.image;
            let maskSrc = cacheData.mask || null;
            
            // 如果不是base64格式，尝试作为URL或其他格式处理
            if (typeof imgSrc !== 'string') {
                console.warn("Image data is not a string, trying to convert:", typeof imgSrc);
                // 可能需要额外的转换逻辑
                imgSrc = String(imgSrc);
            }
            
            console.log("Loading image from source:", imgSrc.substring(0, 50) + "...");
            
            // 加载图像
            const img = await this.loadImageFromCache(imgSrc);
            const mask = maskSrc ? await this.loadImageFromCache(maskSrc) : null;
            
            // 计算缩放比例
            const scale = Math.min(
                this.width / img.width * 0.8,
                this.height / img.height * 0.8
            );
            
            // 获取图层图像，并保留透明度信息
            const finalImage = new Image();
            
            if (mask) {
                // 创建临时画布来合并图像和遮罩
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const tempCtx = tempCanvas.getContext('2d');
                
                // 绘制图像
                tempCtx.drawImage(img, 0, 0);
                
                // 获取图像数据
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
                
                // 获取遮罩数据
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = img.width;
                maskCanvas.height = img.height;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.drawImage(mask, 0, 0);
                const maskData = maskCtx.getImageData(0, 0, img.width, img.height);
                
                // 应用遮罩到alpha通道
                for (let i = 0; i < imageData.data.length; i += 4) {
                    // 使用遮罩的亮度值（假设是灰度图）作为alpha值
                    const maskValue = maskData.data[i];
                    imageData.data[i + 3] = maskValue;
                }
                
                // 将合并后的数据放回画布
                tempCtx.putImageData(imageData, 0, 0);
                
                // 设置最终图像
                await new Promise((resolve) => {
                    finalImage.onload = resolve;
                    finalImage.src = tempCanvas.toDataURL('image/png');
                });
            } else {
                // 如果没有遮罩，直接使用原始图像
                finalImage.src = img.src;
                await new Promise(resolve => {
                    if (finalImage.complete) {
                        resolve();
                    } else {
                        finalImage.onload = resolve;
                    }
                });
            }
            
            // 创建新图层
            const layer = {
                image: finalImage,
                x: (this.width - img.width * scale) / 2,
                y: (this.height - img.height * scale) / 2,
                width: img.width * scale,
                height: img.height * scale,
                rotation: 0,
                zIndex: this.layers.length,
                opacity: 1
            };
            
            this.layers.push(layer);
            this.setSelectedLayer(layer);
            this.render();
            
            console.log("Layer imported successfully");
            
        } catch (error) {
            console.error('Error importing image:', error);
            throw new Error(`Failed to import image: ${error.message}`);
        }
    }

    // 切换等比例缩放模式
    toggleProportionalScaling() {
        this.proportionalScaling = !this.proportionalScaling;
        console.log('等比例缩放模式:', this.proportionalScaling ? '开启' : '关闭');
        return this.proportionalScaling;
    }
    
    // 设置等比例缩放模式
    setProportionalScaling(enabled) {
        this.proportionalScaling = enabled;
        console.log('Proportional scaling:', enabled ? 'enabled' : 'disabled');
    }

    // 新增：复制选中图层
    duplicateSelectedLayer() {
        if (!this.selectedLayer) {
            console.log('No layer selected to duplicate');
            return null;
        }
        
        console.log('Duplicating selected layer...');
        
        // 深拷贝图层数据
        const originalLayer = this.selectedLayer;
        const duplicatedLayer = {
            image: originalLayer.image, // 图像对象可以共享引用
            x: originalLayer.x + 20, // 稍微偏移避免重叠
            y: originalLayer.y + 20,
            width: originalLayer.width,
            height: originalLayer.height,
            rotation: originalLayer.rotation,
            zIndex: this.layers.length, // 新的zIndex
            opacity: originalLayer.opacity
        };
        
        // 如果原图层有遮罩，也复制遮罩
        if (originalLayer.mask) {
            duplicatedLayer.mask = new Float32Array(originalLayer.mask);
        }
        
        if (originalLayer.maskCanvas) {
            // 复制遮罩画布
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = originalLayer.maskCanvas.width;
            maskCanvas.height = originalLayer.maskCanvas.height;
            const maskCtx = maskCanvas.getContext('2d');
            maskCtx.drawImage(originalLayer.maskCanvas, 0, 0);
            duplicatedLayer.maskCanvas = maskCanvas;
        }
        
        // 添加到图层列表
        this.layers.push(duplicatedLayer);
        
        // 选中新复制的图层
        this.setSelectedLayer(duplicatedLayer);
        
        // 重新渲染
        this.render();
        
        console.log(`Layer duplicated successfully. Total layers: ${this.layers.length}`);
        return duplicatedLayer;
    }
    
    // 新增：清除所有缓存数据（相当于刷新页面）
    clearAllCache() {
        console.log('Clearing all cache data...');
        
        // 确认操作
        const confirmed = confirm('确定要清除所有缓存数据吗？这将删除所有图层和编辑内容，相当于刷新页面重来。');
        if (!confirmed) {
            console.log('Cache clear cancelled by user');
            return;
        }
        
        // 停止所有工具
        if (this.lassoTool && this.lassoTool.isActive) {
            this.lassoTool.toggle(false);
        }
        
        if (this.penTool && this.penTool.isActive) {
            this.penTool.deactivate();
        }
        
        // 清除所有图层
        this.layers = [];
        this.selectedLayer = null;
        this.selectedLayers = [];
        
        // 重置画布状态
        this.isRotating = false;
        this.rotationStartAngle = 0;
        this.rotationCenter = { x: 0, y: 0 };
        this.isCtrlPressed = false;
        this.isShiftPressed = false;
        
        // 重置变换状态
        this.activeControlPoint = null;
        this.transformOrigin = { x: 0, y: 0 };
        this.isTransforming = false;
        this.transformType = null;
        this.originalTransform = null;
        
        // 重置混合模式相关状态
        this.selectedBlendMode = null;
        this.blendOpacity = 100;
        this.isAdjustingOpacity = false;
        
        // 清理工具状态
        if (this.lassoTool) {
            // 重置套索工具状态
            if (this.lassoTool.isActive) {
                this.lassoTool.toggle(false);
            }
            // 清除套索工具的状态
            this.lassoTool.clearPath();
            this.lassoTool.targetLayer = null;
            this.lassoTool.hasTempMask = false;
            // 清理原始状态缓存
            this.lassoTool.originalStates.clear();
        }
        
        if (this.penTool) {
            // 重置钢笔工具状态
            if (this.penTool.isActive) {
                this.penTool.deactivate();
            }
            // 清除钢笔工具的所有路径
            this.penTool.clearAllPaths();
        }
        
        // 清空画布
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.offscreenCtx.clearRect(0, 0, this.width, this.height);
        this.tempCtx.clearRect(0, 0, this.width, this.height);
        this.gridCacheCtx.clearRect(0, 0, this.width, this.height);
        
        // 重置数据标志
        this.dataInitialized = false;
        this.pendingDataCheck = null;
        
        // 重新渲染（显示空画布和网格）
        this.render();
        
        // 清理可能的内存引用
        if (typeof gc !== 'undefined') {
            gc(); // 如果支持，触发垃圾回收
        }
        
        console.log('All cache data cleared successfully - canvas reset to initial state');
        
        // 可选：刷新节点数据
        if (this.node && this.node.setDirtyCanvas) {
            this.node.setDirtyCanvas(true);
        }
        
        // 触发UI更新（如果有回调）
        if (this.onCacheCleared) {
            this.onCacheCleared();
        }
    }
} 