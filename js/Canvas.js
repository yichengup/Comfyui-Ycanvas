// 导入套索工具类
import { LassoTool } from "./LassoTool.js";

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
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        
        // 初始化临时画布
        this.tempCanvas.width = this.width;
        this.tempCanvas.height = this.height;
        
        // 添加工具栏容器
        this.toolbarContainer = document.createElement('div');
        this.toolbarContainer.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            display: flex;
            gap: 5px;
            background: rgba(42, 42, 42, 0.8);
            padding: 5px;
            border-radius: 4px;
            z-index: 1000;
        `;
        
        // 添加套索工具按钮
        this.lassoButton = document.createElement('button');
        this.lassoButton.innerHTML = '套索工具';
        this.lassoButton.style.cssText = `
            padding: 5px 10px;
            background: #3a3a3a;
            border: 1px solid #4a4a4a;
            color: white;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        `;
        
        // 添加模式选择器
        this.lassoModeSelect = document.createElement('select');
        this.lassoModeSelect.style.cssText = `
            padding: 5px;
            background: #3a3a3a;
            border: 1px solid #4a4a4a;
            color: white;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            display: none;
        `;
        
        // 添加模式选项
        const modes = [
            { value: 'new', label: '新建' },
            { value: 'add', label: '添加' },
            { value: 'subtract', label: '减去' },
            { value: 'restore', label: '恢复原图' }
        ];
        
        modes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.value;
            option.textContent = mode.label;
            this.lassoModeSelect.appendChild(option);
        });
        
        // 添加清除遮罩按钮
        this.clearMaskButton = document.createElement('button');
        this.clearMaskButton.innerHTML = '清除遮罩';
        this.clearMaskButton.style.cssText = `
            padding: 5px 10px;
            background: #3a3a3a;
            border: 1px solid #4a4a4a;
            color: white;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            display: none;
        `;
        
        // 添加事件监听
        this.lassoButton.addEventListener('click', () => {
            const isActive = !this.lassoTool.isActive;
            this.lassoButton.style.background = isActive ? '#5a5a5a' : '#3a3a3a';
            this.lassoModeSelect.style.display = isActive ? 'block' : 'none';
            this.lassoTool.toggle(isActive);
            this.updateCursor();
        });
        
        this.lassoModeSelect.addEventListener('change', (e) => {
            this.lassoTool.setMode(e.target.value);
        });
        
        this.clearMaskButton.addEventListener('click', () => {
            if (this.lassoTool.clearMask()) {
                // 可以在这里添加成功清除的提示或其他操作
            }
        });
        
        // 将按钮和模式选择器添加到工具栏
        this.toolbarContainer.appendChild(this.lassoButton);
        this.toolbarContainer.appendChild(this.lassoModeSelect);
        this.toolbarContainer.appendChild(this.clearMaskButton);
        
        this.initCanvas();
        this.setupEventListeners();
        this.initNodeData();
        
        // 添加混合模式列表
        this.blendModes = [
            { name: 'normal', label: '正常' },
            { name: 'multiply', label: '正片叠底' },
            { name: 'screen', label: '滤色' },
            { name: 'overlay', label: '叠加' },
            { name: 'darken', label: '变暗' },
            { name: 'lighten', label: '变亮' },
            { name: 'color-dodge', label: '颜色减淡' },
            { name: 'color-burn', label: '颜色加深' },
            { name: 'hard-light', label: '强光' },
            { name: 'soft-light', label: '柔光' },
            { name: 'difference', label: '差值' },
            { name: 'exclusion', label: '排除' }
        ];
        
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
    }

    initCanvas() {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.border = '1px solid black';
        this.canvas.style.maxWidth = '100%';
        this.canvas.style.backgroundColor = '#606060';
        
        // 添加工具栏到画布容器
        const canvasContainer = document.createElement('div');
        canvasContainer.style.position = 'relative';
        canvasContainer.appendChild(this.canvas);
        canvasContainer.appendChild(this.toolbarContainer);
        
        // 将画布容器添加到节点
        this.node.addWidget("canvas", this.widget.name, this.widget.value, (value) => {
            this.widget.value = value;
        }, {
            element: canvasContainer
        });
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
            
            isDragging = false;
            isRotating = false;
            this.isTransforming = false;
            this.activeControlPoint = null;
        });

        // 滚轮事件
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.selectedLayer) return;
            
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
        
        // 调整所有图层的位置和大小
        this.layers.forEach(layer => {
            const scale = Math.min(
                width / layer.image.width * 0.8,
                height / layer.image.height * 0.8
            );
            layer.width = layer.image.width * scale;
            layer.height = layer.image.height * scale;
            layer.x = (width - layer.width) / 2;
            layer.y = (height - layer.height) / 2;
        });
        
        // 更新套索工具的临时画布大小
        if (this.lassoTool) {
            this.lassoTool.updateCanvasSize(width, height);
        }
        
        // 更新临时画布大小
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;
        
        // 更新网格缓存画布大小
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        
        this.render();
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
        
        // 更新移除透明度按钮的显示状态
        if (this.selectedLayer) {
            if (this.clearMaskButton) {
                this.clearMaskButton.style.display = 'block'; // 始终显示，因为图层都可能有透明度
            }
        } else {
            if (this.clearMaskButton) {
                this.clearMaskButton.style.display = 'none'; // 没有选中图层时隐藏
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
            ctx.fillStyle = point.type === 'center' ? '#ffff00' : 
                          point.type === 'rotate' ? '#00ffff' : '#00ff00';
            ctx.strokeStyle = '#ffffff';
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
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

        if (this.selectedLayer) {
            // 获取鼠标位置可能点击的控制点
            const controlPoint = this.getControlPoint(x, y);
            
            if (controlPoint) {
                // 设置不同控制点的光标
                switch (controlPoint.type) {
                    case 'nw':
                    case 'se':
                        this.canvas.style.cursor = 'nwse-resize';
                        break;
                    case 'ne':
                    case 'sw':
                        this.canvas.style.cursor = 'nesw-resize';
                        break;
                    case 'n':
                    case 's':
                        this.canvas.style.cursor = 'ns-resize';
                        break;
                    case 'e':
                    case 'w':
                        this.canvas.style.cursor = 'ew-resize';
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
        return new Promise((resolve) => {
            // 创建临时画布
            const tempCanvas = document.createElement('canvas');
            const maskCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            maskCanvas.width = this.width;
            maskCanvas.height = this.height;
            
            const tempCtx = tempCanvas.getContext('2d');
            const maskCtx = maskCanvas.getContext('2d');

            // 填充白色背景
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, this.width, this.height);
            
            // 填充黑色背景作为遮罩的基础 - 保持黑色背景
            maskCtx.fillStyle = '#000000';
            maskCtx.fillRect(0, 0, this.width, this.height);

            // 按照zIndex顺序绘制所有图层
            this.layers.sort((a, b) => a.zIndex - b.zIndex).forEach(layer => {
                // 绘制主图像
                tempCtx.save();
                tempCtx.globalCompositeOperation = layer.blendMode || 'normal';
                tempCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                
                // 应用变换
                tempCtx.translate(layer.x + layer.width/2, layer.y + layer.height/2);
                tempCtx.rotate(layer.rotation * Math.PI / 180);
                tempCtx.drawImage(
                    layer.image,
                    -layer.width/2,
                    -layer.height/2,
                    layer.width,
                    layer.height
                );
                tempCtx.restore();
                
                // 处理图层遮罩和透明度
                maskCtx.save();
                maskCtx.translate(layer.x + layer.width/2, layer.y + layer.height/2);
                maskCtx.rotate(layer.rotation * Math.PI / 180);
                
                // 创建临时图层画布和它的遮罩 - 用于分析透明度和存在的遮罩
                const layerCanvas = document.createElement('canvas');
                layerCanvas.width = layer.width;
                layerCanvas.height = layer.height;
                const layerCtx = layerCanvas.getContext('2d');
                
                // 绘制图层到临时画布，以捕获其透明度信息
                layerCtx.drawImage(
                    layer.image, 
                    0, 0, 
                    layer.width, layer.height
                );
                
                // 获取图层像素数据（包含透明度信息）
                const layerImageData = layerCtx.getImageData(0, 0, layer.width, layer.height);
                
                // 创建临时蒙版画布
                const layerMaskCanvas = document.createElement('canvas');
                layerMaskCanvas.width = layer.width;
                layerMaskCanvas.height = layer.height;
                const layerMaskCtx = layerMaskCanvas.getContext('2d');
                
                // 创建遮罩图像数据
                const maskImageData = layerMaskCtx.createImageData(layer.width, layer.height);
                
                // 处理遮罩数据
                if (layer.mask) {
                    // 使用显式定义的遮罩
                    const maskArray = layer.mask;
                    for (let i = 0; i < maskArray.length; i++) {
                        const index = i * 4;
                        // 获取原始图像的透明度
                        const imageAlpha = layerImageData.data[index + 3] / 255;
                        // 混合层遮罩值和图像透明度
                        const alpha = maskArray[i] * imageAlpha;
                        // 白色表示非透明区域
                        const value = Math.round(alpha * 255);
                        maskImageData.data[index] = value;
                        maskImageData.data[index + 1] = value;
                        maskImageData.data[index + 2] = value;
                        maskImageData.data[index + 3] = 255;  // 全不透明
                    }
                } else {
                    // 只使用图层自身的透明度
                    for (let i = 0; i < layerImageData.data.length / 4; i++) {
                        const index = i * 4;
                        // 使用图像的alpha通道作为遮罩值
                        const alpha = layerImageData.data[index + 3] / 255;
                        // 白色表示非透明区域
                        const value = Math.round(alpha * 255);
                        maskImageData.data[index] = value;
                        maskImageData.data[index + 1] = value;
                        maskImageData.data[index + 2] = value;
                        maskImageData.data[index + 3] = 255;  // 全不透明
                    }
                }
                
                // 放入临时遮罩画布
                layerMaskCtx.putImageData(maskImageData, 0, 0);
                
                // 使用lighter模式将此图层的遮罩添加到主遮罩
                maskCtx.globalCompositeOperation = 'lighter';
                maskCtx.drawImage(
                    layerMaskCanvas,
                    -layer.width/2,
                    -layer.height/2,
                    layer.width,
                    layer.height
                );
                maskCtx.restore();
            });

            // 保存主图像和遮罩
            tempCanvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append("image", blob, fileName);
                formData.append("overwrite", "true");
                
                try {
                    const resp = await fetch("/upload/image", {
                        method: "POST",
                        body: formData,
                    });

                    if (resp.status === 200) {
                        // 保存遮罩图像
                        maskCanvas.toBlob(async (maskBlob) => {
                            const maskFormData = new FormData();
                            const maskFileName = fileName.replace(/\.[^/.]+$/, '') + '_mask.png';
                            maskFormData.append("image", maskBlob, maskFileName);
                            maskFormData.append("overwrite", "true");

                            try {
                                const maskResp = await fetch("/upload/image", {
                                    method: "POST",
                                    body: maskFormData,
                                });

                                if (maskResp.status === 200) {
                                    const data = await resp.json();
                                    this.widget.value = data.name;
                                    // 触发节点更新
                                    if (this.node) {
                                        this.node.setDirtyCanvas(true);
                                        app.graph.runStep();
                                    }
                                    resolve(true);
                                } else {
                                    console.error("Error saving mask: " + maskResp.status);
                                    resolve(false);
                                }
                            } catch (error) {
                                console.error("Error saving mask:", error);
                                resolve(false);
                            }
                        }, "image/png");
                    } else {
                        console.error(resp.status + " - " + resp.statusText);
                        resolve(false);
                    }
                } catch (error) {
                    console.error(error);
                    resolve(false);
                }
            }, "image/png");
        });
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

    // 改进图像转换方法
    async convertTensorToImage(tensor) {
        try {
            console.log("Converting tensor to image:", tensor);
            
            if (!tensor || !tensor.data || !tensor.width || !tensor.height) {
                throw new Error("Invalid tensor data");
            }

            // 创建临时画布
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = tensor.width;
            canvas.height = tensor.height;

            // 创建像数据
            const imageData = new ImageData(
                new Uint8ClampedArray(tensor.data),
                tensor.width,
                tensor.height
            );

            // 将数据绘制到画布
            ctx.putImageData(imageData, 0, 0);

            // 创建新图像
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = (e) => reject(new Error("Failed to load image: " + e));
                img.src = canvas.toDataURL();
            });
        } catch (error) {
            console.error("Error converting tensor to image:", error);
            throw error;
        }
    }

    // 改进遮罩转换方法
    async convertTensorToMask(tensor) {
        if (!tensor || !tensor.data) {
            throw new Error("Invalid mask tensor");
        }

        try {
            // 确保数据是Float32Array
            return new Float32Array(tensor.data);
        } catch (error) {
            throw new Error(`Mask conversion failed: ${error.message}`);
        }
    }

    // 改进数据初始化方法
    async initNodeData() {
        try {
            console.log("Starting node data initialization...");
            
            // 检查节点和输入是否存在
            if (!this.node || !this.node.inputs) {
                console.log("Node or inputs not ready");
                return this.scheduleDataCheck();
            }

            // 检查图像入
            if (this.node.inputs[0] && this.node.inputs[0].link) {
                const imageLinkId = this.node.inputs[0].link;
                const imageData = app.nodeOutputs[imageLinkId];
                
                if (imageData) {
                    console.log("Found image data:", imageData);
                    await this.processImageData(imageData);
                    this.dataInitialized = true;
                } else {
                    console.log("Image data not available yet");
                    return this.scheduleDataCheck();
                }
            }

            // 检查遮罩输入
            if (this.node.inputs[1] && this.node.inputs[1].link) {
                const maskLinkId = this.node.inputs[1].link;
                const maskData = app.nodeOutputs[maskLinkId];
                
                if (maskData) {
                    console.log("Found mask data:", maskData);
                    await this.processMaskData(maskData);
                }
            }

        } catch (error) {
            console.error("Error in initNodeData:", error);
            return this.scheduleDataCheck();
        }
        this.cleanupLayers();
    }

    // 添加数据检查调度方法
    scheduleDataCheck() {
        if (this.pendingDataCheck) {
            clearTimeout(this.pendingDataCheck);
        }
        
        this.pendingDataCheck = setTimeout(() => {
            this.pendingDataCheck = null;
            if (!this.dataInitialized) {
                this.initNodeData();
            }
        }, 1000); // 1秒后重试
    }

    // 修改图像数据处理方法
    async processImageData(imageData) {
        try {
            if (!imageData) return;
            
            console.log("Processing image data:", {
                type: typeof imageData,
                isArray: Array.isArray(imageData),
                shape: imageData.shape,
                hasData: !!imageData.data
            });
            
            // 处理数组格式
            if (Array.isArray(imageData)) {
                imageData = imageData[0];
            }
            
            // 验证数据格式
            if (!imageData.shape || !imageData.data) {
                throw new Error("Invalid image data format");
            }
            
            // 保持原始尺寸和比例
            const originalWidth = imageData.shape[2];
            const originalHeight = imageData.shape[1];
            
            // 计算适当的缩放比例
            const scale = Math.min(
                this.width / originalWidth * 0.8,
                this.height / originalHeight * 0.8
            );
            
            // 转换数据
            const convertedData = this.convertTensorToImageData(imageData);
            if (convertedData) {
                const image = await this.createImageFromData(convertedData);
                
                // 使用计算的缩放比例添加图层
                this.addScaledLayer(image, scale);
                console.log("Image layer added successfully with scale:", scale);
            }
        } catch (error) {
            console.error("Error processing image data:", error);
            throw error;
        }
    }

    // 添加新的缩放图层方法
    addScaledLayer(image, scale) {
        try {
            const scaledWidth = image.width * scale;
            const scaledHeight = image.height * scale;
            
            const layer = {
                image: image,
                x: (this.width - scaledWidth) / 2,
                y: (this.height - scaledHeight) / 2,
                width: scaledWidth,
                height: scaledHeight,
                rotation: 0,
                zIndex: this.layers.length,
                originalWidth: image.width,
                originalHeight: image.height
            };
            
            this.layers.push(layer);
            this.selectedLayer = layer;
            this.render();
            
            console.log("Scaled layer added:", {
                originalSize: `${image.width}x${image.height}`,
                scaledSize: `${scaledWidth}x${scaledHeight}`,
                scale: scale
            });
        } catch (error) {
            console.error("Error adding scaled layer:", error);
            throw error;
        }
    }

    // 改进张量转换方法
    convertTensorToImageData(tensor) {
        try {
            const shape = tensor.shape;
            const height = shape[1];
            const width = shape[2];
            const channels = shape[3];
            
            console.log("Converting tensor:", {
                shape: shape,
                dataRange: {
                    min: tensor.min_val,
                    max: tensor.max_val
                }
            });
            
            // 创建图像数据
            const imageData = new ImageData(width, height);
            const data = new Uint8ClampedArray(width * height * 4);
            
            // 重建数据结构
            const flatData = tensor.data;
            const pixelCount = width * height;
            
            for (let i = 0; i < pixelCount; i++) {
                const pixelIndex = i * 4;
                const tensorIndex = i * channels;
                
                // 正确处理RGB通道
                for (let c = 0; c < channels; c++) {
                    const value = flatData[tensorIndex + c];
                    // 根据实际值范围行映射
                    const normalizedValue = (value - tensor.min_val) / (tensor.max_val - tensor.min_val);
                    data[pixelIndex + c] = Math.round(normalizedValue * 255);
                }
                
                // Alpha通道
                data[pixelIndex + 3] = 255;
            }
            
            imageData.data.set(data);
            return imageData;
        } catch (error) {
            console.error("Error converting tensor:", error);
            return null;
        }
    }

    // 添加图像创建方法
    async createImageFromData(imageData) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            canvas.width = imageData.width;
            canvas.height = imageData.height;
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);

            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = canvas.toDataURL();
        });
    }

    // 添加数据重试机制
    async retryDataLoad(maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.initNodeData();
                return;
            } catch (error) {
                console.warn(`Retry ${i + 1}/${maxRetries} failed:`, error);
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        console.error("Failed to load data after", maxRetries, "retries");
    }

    async processMaskData(maskData) {
        try {
            if (!maskData) return;
            
            console.log("Processing mask data:", maskData);
            
            // 处理数组格式
            if (Array.isArray(maskData)) {
                maskData = maskData[0];
            }
            
            // 检查数据格式
            if (!maskData.shape || !maskData.data) {
                throw new Error("Invalid mask data format");
            }
            
            // 如果有选中的图层，应用遮罩
            if (this.selectedLayer) {
                const maskTensor = await this.convertTensorToMask(maskData);
                this.selectedLayer.mask = maskTensor;
                this.render();
                console.log("Mask applied to selected layer");
            }
        } catch (error) {
            console.error("Error processing mask data:", error);
        }
    }

    async loadImageFromCache(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = base64Data;
        });
    }

    async importImage(cacheData) {
        try {
            console.log("Starting image import with cache data");
            const img = await this.loadImageFromCache(cacheData.image);
            const mask = cacheData.mask ? await this.loadImageFromCache(cacheData.mask) : null;
            
            // 计算缩放比例
            const scale = Math.min(
                this.width / img.width * 0.8,
                this.height / img.height * 0.8
            );
            
            // 创建临时画布来合并图像和遮罩
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // 绘制图像
            tempCtx.drawImage(img, 0, 0);
            
            let hasAlpha = false; // 标记是否有有效遮罩
            
            // 如果有遮罩，应用遮罩
            if (mask) {
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = img.width;
                maskCanvas.height = img.height;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.drawImage(mask, 0, 0);
                const maskData = maskCtx.getImageData(0, 0, img.width, img.height);
                
                // 应用遮罩到alpha通道
                for (let i = 0; i < imageData.data.length; i += 4) {
                    // 使用遮罩亮度值作为alpha值
                    // 遮罩应该是白色=不透明，黑色=透明
                    const maskAlpha = maskData.data[i]; // 使用R通道作为mask值
                    if (maskAlpha > 0) hasAlpha = true;
                    imageData.data[i + 3] = maskAlpha;
                }
                
                tempCtx.putImageData(imageData, 0, 0);
            }
            
            // 创建最终图像
            const finalImage = new Image();
            await new Promise((resolve) => {
                finalImage.onload = resolve;
                finalImage.src = tempCanvas.toDataURL();
            });
            
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
            
            // 如果有遮罩并且没有明显的alpha通道，则存储显式mask
            if (mask && !hasAlpha) {
                // 创建遮罩数据
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = img.width;
                maskCanvas.height = img.height;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.drawImage(mask, 0, 0);
                const maskData = maskCtx.getImageData(0, 0, img.width, img.height);
                
                // 从图像数据创建Float32Array蒙版
                const maskArray = new Float32Array(img.width * img.height);
                for (let i = 0; i < maskArray.length; i++) {
                    maskArray[i] = maskData.data[i * 4] / 255; // 将0-255转为0-1
                }
                
                layer.mask = maskArray;
                console.log("Created explicit layer mask");
            }
            
            this.layers.push(layer);
            this.selectedLayer = layer;
            this.render();
            
            console.log("Image imported successfully with mask");
            
        } catch (error) {
            console.error('Error importing image:', error);
        }
    }

    // 修改 showBlendModeMenu 方法
    showBlendModeMenu(x, y) {
        // 移除已存在的菜单
        const existingMenu = document.getElementById('blend-mode-menu');
        if (existingMenu) {
            document.body.removeChild(existingMenu);
        }

        const menu = document.createElement('div');
        menu.id = 'blend-mode-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            background: #2a2a2a;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            padding: 5px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;

        this.blendModes.forEach(mode => {
            const container = document.createElement('div');
            container.className = 'blend-mode-container';
            container.style.cssText = `
                margin-bottom: 5px;
            `;

            const option = document.createElement('div');
            option.style.cssText = `
                padding: 5px 10px;
                color: white;
                cursor: pointer;
                transition: background-color 0.2s;
            `;
            option.textContent = `${mode.label} (${mode.name})`;
            
            // 创建滑动条，使用当前图层的透明度值
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            // 使用当前图层的透明度值，如果存在的话
            slider.value = this.selectedLayer.opacity ? Math.round(this.selectedLayer.opacity * 100) : 100;
            slider.style.cssText = `
                width: 100%;
                margin: 5px 0;
                display: none;
            `;

            // 如果是当前图层的混合模式，显示滑动条
            if (this.selectedLayer.blendMode === mode.name) {
                slider.style.display = 'block';
                option.style.backgroundColor = '#3a3a3a';
            }

            // 修改点击事件
            option.onclick = () => {
                // 隐藏所有其他滑动条
                menu.querySelectorAll('input[type="range"]').forEach(s => {
                    s.style.display = 'none';
                });
                menu.querySelectorAll('.blend-mode-container div').forEach(d => {
                    d.style.backgroundColor = '';
                });
                
                // 显示当前选项的滑动条
                slider.style.display = 'block';
                option.style.backgroundColor = '#3a3a3a';
                
                // 设置当前选中的混合模式
                if (this.selectedLayer) {
                    this.selectedLayer.blendMode = mode.name;
                    this.render();
                }
            };

            // 添加滑动条的input事件（实时更新）
            slider.addEventListener('input', () => {
                if (this.selectedLayer) {
                    this.selectedLayer.opacity = slider.value / 100;
                    this.render();
                }
            });

            // 添加滑动条的change事件（结束拖动时保存状态）
            slider.addEventListener('change', async () => {
                if (this.selectedLayer) {
                    this.selectedLayer.opacity = slider.value / 100;
                    this.render();
                    // 保存到服务器并更新节点
                    await this.saveToServer(this.widget.value);
                    if (this.node) {
                        app.graph.runStep();
                    }
                }
            });

            container.appendChild(option);
            container.appendChild(slider);
            menu.appendChild(container);
        });

        document.body.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('mousedown', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', closeMenu);
        }, 0);
    }

    handleBlendModeSelection(mode) {
        if (this.selectedBlendMode === mode && !this.isAdjustingOpacity) {
            // 第二次点击，应用效果
            this.applyBlendMode(mode, this.blendOpacity);
            this.closeBlendModeMenu();
        } else {
            // 第一次点击，显示透明度调整器
            this.selectedBlendMode = mode;
            this.isAdjustingOpacity = true;
            this.showOpacitySlider(mode);
        }
    }

    showOpacitySlider(mode) {
        // 创建滑动条
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = this.blendOpacity;
        slider.className = 'blend-opacity-slider';
        
        slider.addEventListener('input', (e) => {
            this.blendOpacity = parseInt(e.target.value);
            // 可以添加实时预览效果
        });
        
        // 将滑动条添加到对应的混合模式选项下
        const modeElement = document.querySelector(`[data-blend-mode="${mode}"]`);
        if (modeElement) {
            modeElement.appendChild(slider);
        }
    }

    applyBlendMode(mode, opacity) {
        // 应用混合模式和透明度
        this.currentLayer.style.mixBlendMode = mode;
        this.currentLayer.style.opacity = opacity / 100;
        
        // 清理状态
        this.selectedBlendMode = null;
        this.isAdjustingOpacity = false;
    }

    // 处理角点变形
    handleCornerTransform(type, dx, dy, original) {
        const layer = this.selectedLayer;
        const minSize = 20;
        
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
    
    // 处理边线变形
    handleEdgeTransform(type, dx, dy, original) {
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
} 