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
        
        this.initCanvas();
        this.setupEventListeners();
    }

    initCanvas() {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.border = '1px solid black';
        this.canvas.style.maxWidth = '100%';
        this.canvas.style.backgroundColor = '#606060';
    }

    setupEventListeners() {
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        let isRotating = false;
        let isResizing = false;
        let resizeHandle = null;
        let lastClickTime = 0;
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = true;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = false;
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            const currentTime = new Date().getTime();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (currentTime - lastClickTime < 300) {
                this.selectedLayers = [];
                this.selectedLayer = null;
                this.render();
                return;
            }
            lastClickTime = currentTime;

            const result = this.getLayerAtPosition(mouseX, mouseY);
            
            if (result) {
                const clickedLayer = result.layer;
                
                if (this.isCtrlPressed) {
                    const index = this.selectedLayers.indexOf(clickedLayer);
                    if (index === -1) {
                        this.selectedLayers.push(clickedLayer);
                        this.selectedLayer = clickedLayer;
                    } else {
                        this.selectedLayers.splice(index, 1);
                        this.selectedLayer = this.selectedLayers[this.selectedLayers.length - 1] || null;
                    }
                } else {
                    if (!this.selectedLayers.includes(clickedLayer)) {
                        this.selectedLayers = [clickedLayer];
                        this.selectedLayer = clickedLayer;
                    }
                }

                if (this.isRotationHandle(mouseX, mouseY)) {
                    isRotating = true;
                    this.rotationCenter.x = this.selectedLayer.x + this.selectedLayer.width/2;
                    this.rotationCenter.y = this.selectedLayer.y + this.selectedLayer.height/2;
                    this.rotationStartAngle = Math.atan2(
                        mouseY - this.rotationCenter.y,
                        mouseX - this.rotationCenter.x
                    );
                } else {
                    isDragging = true;
                    lastX = mouseX;
                    lastY = mouseY;
                }
            } else {
                if (!this.isCtrlPressed) {
                    this.selectedLayers = [];
                    this.selectedLayer = null;
                }
            }
            this.render();
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.selectedLayer) return;
            
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (isResizing && resizeHandle) {
                const dx = mouseX - lastX;
                const dy = mouseY - lastY;
                
                this.selectedLayers.forEach(layer => {
                    const originalWidth = layer.width;
                    const originalHeight = layer.height;
                    const originalX = layer.x;
                    const originalY = layer.y;

                    switch(resizeHandle) {
                        case 'nw':
                            layer.width = Math.max(20, originalWidth - dx);
                            layer.height = Math.max(20, originalHeight - dy);
                            layer.x = originalX + (originalWidth - layer.width);
                            layer.y = originalY + (originalHeight - layer.height);
                            break;
                        case 'ne':
                            layer.width = Math.max(20, originalWidth + dx);
                            layer.height = Math.max(20, originalHeight - dy);
                            layer.y = originalY + (originalHeight - layer.height);
                            break;
                        case 'se':
                            layer.width = Math.max(20, originalWidth + dx);
                            layer.height = Math.max(20, originalHeight + dy);
                            break;
                        case 'sw':
                            layer.width = Math.max(20, originalWidth - dx);
                            layer.height = Math.max(20, originalHeight + dy);
                            layer.x = originalX + (originalWidth - layer.width);
                            break;
                    }
                });
                
                lastX = mouseX;
                lastY = mouseY;
                this.render();
            } else if (isRotating) {
                const currentAngle = Math.atan2(
                    mouseY - this.rotationCenter.y,
                    mouseX - this.rotationCenter.x
                );
                let rotation = (currentAngle - this.rotationStartAngle) * (180/Math.PI);
                const snap = 15;
                rotation = Math.round(rotation / snap) * snap;
                
                this.selectedLayers.forEach(layer => {
                    layer.rotation = rotation;
                });
                this.render();
            } else if (isDragging) {
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

            const cursor = this.getResizeHandle(mouseX, mouseY) 
                ? 'nw-resize' 
                : this.isRotationHandle(mouseX, mouseY) 
                    ? 'grab' 
                    : isDragging ? 'move' : 'default';
            this.canvas.style.cursor = cursor;
        });

        this.canvas.addEventListener('mouseup', () => {
            isDragging = false;
            isRotating = false;
        });

        this.canvas.addEventListener('mouseleave', () => {
            isDragging = false;
            isRotating = false;
        });

        // 添加鼠标滚轮缩放功能
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.selectedLayer) return;
            
            e.preventDefault();
            const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
            
            // 如果按住Shift键，则进行旋转而不是缩放
            if (e.shiftKey) {
                const rotateAngle = e.deltaY > 0 ? -5 : 5;
                this.selectedLayers.forEach(layer => {
                    layer.rotation = (layer.rotation + rotateAngle) % 360;
                });
            } else {
                // 从鼠标位置为中心进行缩放
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                this.selectedLayers.forEach(layer => {
                    const centerX = layer.x + layer.width/2;
                    const centerY = layer.y + layer.height/2;
                    
                    // 计算鼠标相对于图层中心的位置
                    const relativeX = mouseX - centerX;
                    const relativeY = mouseY - centerY;
                    
                    // 更新尺寸
                    const oldWidth = layer.width;
                    const oldHeight = layer.height;
                    layer.width *= scaleFactor;
                    layer.height *= scaleFactor;
                    
                    // 调整位置以保持鼠标指向的点不变
                    layer.x += (oldWidth - layer.width) / 2;
                    layer.y += (oldHeight - layer.height) / 2;
                });
            }
            this.render();
        });

        // 优化旋转控制逻辑
        let initialRotation = 0;
        let initialAngle = 0;

        this.canvas.addEventListener('mousemove', (e) => {
            // ... 其他代码保持不变 ...

            if (isRotating) {
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                const centerX = this.selectedLayer.x + this.selectedLayer.width/2;
                const centerY = this.selectedLayer.y + this.selectedLayer.height/2;
                
                // 计算当前角度
                const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
                
                if (e.shiftKey) {
                    // 按住Shift键时启用15度角度吸附
                    const snap = 15;
                    const rotation = Math.round((angle - initialAngle + initialRotation) / snap) * snap;
                    this.selectedLayers.forEach(layer => {
                        layer.rotation = rotation;
                    });
                } else {
                    // 正常旋转
                    const rotation = angle - initialAngle + initialRotation;
                    this.selectedLayers.forEach(layer => {
                        layer.rotation = rotation;
                    });
                }
                this.render();
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            // ... 其他代码保持不变 ...

            if (this.isRotationHandle(mouseX, mouseY)) {
                isRotating = true;
                const centerX = this.selectedLayer.x + this.selectedLayer.width/2;
                const centerY = this.selectedLayer.y + this.selectedLayer.height/2;
                initialRotation = this.selectedLayer.rotation;
                initialAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
            }
        });

        // 添加键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (!this.selectedLayer) return;
            
            const step = e.shiftKey ? 1 : 5; // Shift键按下时更精细的控制
            
            switch(e.key) {
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
                case '[':
                    this.selectedLayers.forEach(layer => layer.rotation -= step);
                    break;
                case ']':
                    this.selectedLayers.forEach(layer => layer.rotation += step);
                    break;
            }
            
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']'].includes(e.key)) {
                e.preventDefault();
                this.render();
            }
        });
    }

    isRotationHandle(x, y) {
        if (!this.selectedLayer) return false;
        
        const handleX = this.selectedLayer.x + this.selectedLayer.width/2;
        const handleY = this.selectedLayer.y - 20;
        const handleRadius = 5;
        
        return Math.sqrt(Math.pow(x - handleX, 2) + Math.pow(y - handleY, 2)) <= handleRadius;
    }

    addLayer(image) {
        const layer = {
            image: image,
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

    removeLayer(index) {
        if (index >= 0 && index < this.layers.length) {
            this.layers.splice(index, 1);
            this.selectedLayer = this.layers[this.layers.length - 1] || null;
            this.render();
        }
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
            layer.width *= scale;
            layer.height *= scale;
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
        
        this.render();
    }

    render() {
        if (this.renderAnimationFrame) {
            this.isDirty = true;
            return;
        }
        
        this.renderAnimationFrame = requestAnimationFrame(() => {
            const now = performance.now();
            if (now - this.lastRenderTime >= this.renderInterval) {
                this.lastRenderTime = now;
                this.actualRender();
                this.isDirty = false;
            }
            
            if (this.isDirty) {
                this.renderAnimationFrame = null;
                this.render();
            } else {
                this.renderAnimationFrame = null;
            }
        });
    }

    actualRender() {
        if (this.offscreenCanvas.width !== this.width || 
            this.offscreenCanvas.height !== this.height) {
            this.offscreenCanvas.width = this.width;
            this.offscreenCanvas.height = this.height;
        }

        const ctx = this.offscreenCtx;
        
        ctx.fillStyle = '#606060';
        ctx.fillRect(0, 0, this.width, this.height);
        
        this.drawCachedGrid();
        
        const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);
        
        sortedLayers.forEach(layer => {
            if (!layer.image || layer.width <= 0 || layer.height <= 0) return;
            
            ctx.save();
            
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            const rad = layer.rotation * Math.PI / 180;
            
            ctx.setTransform(
                Math.cos(rad), Math.sin(rad),
                -Math.sin(rad), Math.cos(rad),
                centerX, centerY
            );
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(
                layer.image,
                -layer.width/2,
                -layer.height/2,
                layer.width,
                layer.height
            );
            
            if (this.selectedLayers.includes(layer)) {
                this.drawSelectionFrame(layer);
            }
            
            ctx.restore();
        });
        
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
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

    drawSelectionFrame(layer) {
        const ctx = this.offscreenCtx;
        
        ctx.beginPath();
        
        ctx.rect(-layer.width/2, -layer.height/2, layer.width, layer.height);
        
        ctx.moveTo(0, -layer.height/2);
        ctx.lineTo(0, -layer.height/2 - 20);
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.beginPath();
        
        const points = [
            {x: 0, y: -layer.height/2 - 20},
            {x: -layer.width/2, y: -layer.height/2},
            {x: layer.width/2, y: -layer.height/2},
            {x: layer.width/2, y: layer.height/2},
            {x: -layer.width/2, y: layer.height/2}
        ];
        
        points.forEach(point => {
            ctx.moveTo(point.x, point.y);
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        });
        
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
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
            
            // 填充黑色背景作为遮罩的基础（表示完全透明）
            maskCtx.fillStyle = '#000000';
            maskCtx.fillRect(0, 0, this.width, this.height);

            // 绘制所有图层
            this.layers.sort((a, b) => a.zIndex - b.zIndex).forEach(layer => {
                // 绘制主图像
                tempCtx.save();
                tempCtx.translate(layer.x + layer.width/2, layer.y + layer.height/2);
                tempCtx.rotate(layer.rotation * Math.PI / 180);
                
                // 创建临时画布来处理透明度
                const layerCanvas = document.createElement('canvas');
                layerCanvas.width = layer.width;
                layerCanvas.height = layer.height;
                const layerCtx = layerCanvas.getContext('2d');
                
                // 绘制图层到临时画布
                layerCtx.drawImage(
                    layer.image,
                    0,
                    0,
                    layer.width,
                    layer.height
                );
                
                // 获取图层的像素数据
                const imageData = layerCtx.getImageData(0, 0, layer.width, layer.height);
                const data = imageData.data;
                
                // 创建遮罩数据
                const maskImageData = new ImageData(layer.width, layer.height);
                const maskData = maskImageData.data;
                
                // 处理每个像素的透明度
                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3] / 255; // 获取原始alpha值
                    
                    // 设置遮罩像素值（白色表示不透明区域）
                    maskData[i] = maskData[i + 1] = maskData[i + 2] = 255 * alpha;
                    maskData[i + 3] = 255; // 遮罩本身始终不透明
                }
                
                // 将处理后的图层绘制到主画布
                tempCtx.drawImage(layerCanvas, -layer.width/2, -layer.height/2);
                
                // 绘制遮罩
                maskCtx.save();
                maskCtx.translate(layer.x + layer.width/2, layer.y + layer.height/2);
                maskCtx.rotate(layer.rotation * Math.PI / 180);
                
                // 创建临时遮罩画布
                const tempMaskCanvas = document.createElement('canvas');
                tempMaskCanvas.width = layer.width;
                tempMaskCanvas.height = layer.height;
                const tempMaskCtx = tempMaskCanvas.getContext('2d');
                
                // 将遮罩数据绘制到临时画布
                tempMaskCtx.putImageData(maskImageData, 0, 0);
                
                // 使用lighter混合模式来叠加透明度
                maskCtx.globalCompositeOperation = 'lighter';
                maskCtx.drawImage(tempMaskCanvas, -layer.width/2, -layer.height/2);
                
                maskCtx.restore();
                tempCtx.restore();
            });

            // 在保存遮罩之前反转遮罩数据
            const maskData = maskCtx.getImageData(0, 0, this.width, this.height);
            const data = maskData.data;
            for (let i = 0; i < data.length; i += 4) {
                // 反转RGB值（255 - 原值）
                data[i] = data[i + 1] = data[i + 2] = 255 - data[i];
                data[i + 3] = 255; // Alpha保持不变
            }
            maskCtx.putImageData(maskData, 0, 0);

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
                            const maskFileName = fileName.replace('.png', '_mask.png');
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
        // 获取画布的实际显示尺寸和位置
        const rect = this.canvas.getBoundingClientRect();
        
        // 计算画布的缩放比例
        const displayWidth = rect.width;
        const displayHeight = rect.height;
        const scaleX = this.width / displayWidth;
        const scaleY = this.height / displayHeight;
        
        // 计算鼠标在画布上的实际位置
        const canvasX = (x) * scaleX;
        const canvasY = (y) * scaleY;
        
        // 从上层到下层遍历所有图层
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            
            // 计算旋转后的点击位置
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            const rad = -layer.rotation * Math.PI / 180;
            
            // 将点击坐标转换到图层的本地坐标系
            const dx = canvasX - centerX;
            const dy = canvasY - centerY;
            const rotatedX = dx * Math.cos(rad) - dy * Math.sin(rad) + centerX;
            const rotatedY = dx * Math.sin(rad) + dy * Math.cos(rad) + centerY;
            
            // 检查点击位置是否在图层范围内
            if (rotatedX >= layer.x && 
                rotatedX <= layer.x + layer.width &&
                rotatedY >= layer.y && 
                rotatedY <= layer.y + layer.height) {
                
                // 创建临时画布来检查透明度
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.width = layer.width;
                tempCanvas.height = layer.height;
                
                // 绘制图层到临时画布
                tempCtx.save();
                tempCtx.clearRect(0, 0, layer.width, layer.height);
                tempCtx.drawImage(
                    layer.image,
                    0,
                    0,
                    layer.width,
                    layer.height
                );
                tempCtx.restore();
                
                // 获取点击位置的像素数据
                const localX = rotatedX - layer.x;
                const localY = rotatedY - layer.y;
                
                try {
                    const pixel = tempCtx.getImageData(
                        Math.round(localX), 
                        Math.round(localY), 
                        1, 1
                    ).data;
                    // 检查像素的alpha值
                    if (pixel[3] > 10) {
                        return {
                            layer: layer,
                            localX: localX,
                            localY: localY
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
} 