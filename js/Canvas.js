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
        
        this.dataInitialized = false;
        this.pendingDataCheck = null;
        
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
        let isAltPressed = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let originalWidth = 0;
        let originalHeight = 0;
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = true;
            }
            if (e.key === 'Alt') {
                isAltPressed = true;
                e.preventDefault();
            }
            if (e.key === 'Delete' && this.selectedLayer) {
                const index = this.layers.indexOf(this.selectedLayer);
                this.removeLayer(index);
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                this.isCtrlPressed = false;
            }
            if (e.key === 'Alt') {
                isAltPressed = false;
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
                
                dragStartX = mouseX;
                dragStartY = mouseY;
                if (clickedLayer) {
                    originalWidth = clickedLayer.width;
                    originalHeight = clickedLayer.height;
                }
                
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
            
            if (isDragging && isAltPressed) {
                const dx = mouseX - dragStartX;
                const dy = mouseY - dragStartY;
                
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.selectedLayer.width = Math.max(20, originalWidth + dx);
                } else {
                    this.selectedLayer.height = Math.max(20, originalHeight + dy);
                }
                
                this.render();
            } else if (isDragging && !isAltPressed) {
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

            const cursor = isAltPressed && isDragging 
                ? (Math.abs(mouseX - dragStartX) > Math.abs(mouseY - dragStartY) ? 'ew-resize' : 'ns-resize')
                : this.getResizeHandle(mouseX, mouseY) 
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
                    
                    // 计算鼠标相对于图中心的位置
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

        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (e.shiftKey) {
                const result = this.getLayerAtPosition(mouseX, mouseY);
                if (result) {
                    this.selectedLayer = result.layer;
                    this.showBlendModeMenu(e.clientX, e.clientY);
                    e.preventDefault(); // 阻止默认行为
                    return;
                }
            }
            
            // ... 其余现的mousedown处理代 ...
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
        try {
            console.log("Adding layer with image:", image);
            
            const layer = {
                image: image,
                x: (this.width - image.width) / 2,
                y: (this.height - image.height) / 2,
                width: image.width,
                height: image.height,
                rotation: 0,
                zIndex: this.layers.length,
                blendMode: 'normal',  // 添加默认混合模式
                opacity: 1  // 添加默认透明度
            };
            
            this.layers.push(layer);
            this.selectedLayer = layer;
            this.render();
            
            console.log("Layer added successfully");
        } catch (error) {
            console.error("Error adding layer:", error);
            throw error;
        }
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
            if (!layer.image) return;
            
            ctx.save();
            
            // 应用混合模式和不透明度
            ctx.globalCompositeOperation = layer.blendMode || 'normal';
            ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
            
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            const rad = layer.rotation * Math.PI / 180;
            
            // 1. 先设置变换
            ctx.setTransform(
                Math.cos(rad), Math.sin(rad),
                -Math.sin(rad), Math.cos(rad),
                centerX, centerY
            );
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // 2. 先绘制原始图像
            ctx.drawImage(
                layer.image,
                -layer.width/2,
                -layer.height/2,
                layer.width,
                layer.height
            );
            
            // 3. 再应用遮罩
            if (layer.mask) {
                try {
                    console.log("Applying mask to layer");
                    const maskCanvas = document.createElement('canvas');
                    const maskCtx = maskCanvas.getContext('2d');
                    maskCanvas.width = layer.width;
                    maskCanvas.height = layer.height;
                    
                    const maskImageData = maskCtx.createImageData(layer.width, layer.height);
                    const maskData = new Float32Array(layer.mask);
                    for (let i = 0; i < maskData.length; i++) {
                        maskImageData.data[i * 4] = 
                        maskImageData.data[i * 4 + 1] = 
                        maskImageData.data[i * 4 + 2] = 255;
                        maskImageData.data[i * 4 + 3] = maskData[i] * 255;
                    }
                    maskCtx.putImageData(maskImageData, 0, 0);
                    
                    // 使用destination-in混合模式
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(maskCanvas, 
                        -layer.width/2, -layer.height/2,
                        layer.width, layer.height
                    );
                    
                    console.log("Mask applied successfully");
                } catch (error) {
                    console.error("Error applying mask:", error);
                }
            }
            
            // 4. 最后绘制选择框
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
            
            // 填充黑色背景作为遮罩的基础
            maskCtx.fillStyle = '#000000';
            maskCtx.fillRect(0, 0, this.width, this.height);

            // 按照zIndex顺序绘制所有图层
            this.layers.sort((a, b) => a.zIndex - b.zIndex).forEach(layer => {
                // 绘制主图像，包含混合模式和透明度
                tempCtx.save();
                
                // 应用混合模式和透明度
                tempCtx.globalCompositeOperation = layer.blendMode || 'normal';
                tempCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                
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
                
                // 处理遮罩
                maskCtx.save();
                maskCtx.translate(layer.x + layer.width/2, layer.y + layer.height/2);
                maskCtx.rotate(layer.rotation * Math.PI / 180);
                maskCtx.globalCompositeOperation = 'lighter';
                
                // 如果图层有遮罩，使用它
                if (layer.mask) {
                    maskCtx.drawImage(layer.mask, -layer.width/2, -layer.height/2, layer.width, layer.height);
                } else {
                    // 如果没有遮罩，使用图层的alpha通道和透明度值
                    const layerCanvas = document.createElement('canvas');
                    layerCanvas.width = layer.width;
                    layerCanvas.height = layer.height;
                    const layerCtx = layerCanvas.getContext('2d');
                    layerCtx.drawImage(layer.image, 0, 0, layer.width, layer.height);
                    const imageData = layerCtx.getImageData(0, 0, layer.width, layer.height);
                    
                    // 创建遮罩画布
                    const alphaCanvas = document.createElement('canvas');
                    alphaCanvas.width = layer.width;
                    alphaCanvas.height = layer.height;
                    const alphaCtx = alphaCanvas.getContext('2d');
                    const alphaData = alphaCtx.createImageData(layer.width, layer.height);
                    
                    // 提取alpha通道并应用图层透明度
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        const alpha = imageData.data[i + 3] * (layer.opacity !== undefined ? layer.opacity : 1);
                        alphaData.data[i] = alphaData.data[i + 1] = alphaData.data[i + 2] = alpha;
                        alphaData.data[i + 3] = 255;
                    }
                    
                    alphaCtx.putImageData(alphaData, 0, 0);
                    maskCtx.drawImage(alphaCanvas, -layer.width/2, -layer.height/2, layer.width, layer.height);
                }
                maskCtx.restore();
            });

            // 反转最终的遮罩
            const finalMaskData = maskCtx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < finalMaskData.data.length; i += 4) {
                finalMaskData.data[i] = 
                finalMaskData.data[i + 1] = 
                finalMaskData.data[i + 2] = 255 - finalMaskData.data[i];
                finalMaskData.data[i + 3] = 255;
            }
            maskCtx.putImageData(finalMaskData, 0, 0);

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

            // 检查图像��入
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
                    imageData.data[i + 3] = maskData.data[i];
                }
                
                tempCtx.putImageData(imageData, 0, 0);
            }
            
            // 创��最终图像
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
                zIndex: this.layers.length
            };
            
            this.layers.push(layer);
            this.selectedLayer = layer;
            this.render();
            
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
} 