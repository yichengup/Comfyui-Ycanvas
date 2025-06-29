// LassoTool.js - 封装套索工具功能

export class LassoTool {
    constructor(canvas) {
        this.canvas = canvas;
        this.isActive = false;
        this.mode = 'new'; // 'new', 'add', 'subtract', 'restore'
        this.path = new Path2D();
        this.points = [];
        this.isDrawing = false;
        this.targetLayer = null; // 存储当前作用的目标图层
        this.hasTempMask = false; // 标记是否有临时遮罩需要应用
        
        // 临时画布用于预览
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        
        // 初始化临时画布大小
        this.updateCanvasSize(canvas.width, canvas.height);

        // 性能优化参数
        this.lastPointTime = 0;
        this.pointThrottleInterval = 10; // 毫秒，控制点的采样率
        this.minPointDistance = 5; // 最小点距离，用于抽样
        this.lastPoint = null;
        this.renderRequestId = null;
        this.pendingRender = false;
        
        // 防止意外合并
        this.autoMergeDisabled = true; // 默认禁用自动合并
        this.minPointsForValidPath = 5; // 有效路径的最小点数
        this.lastMouseMoveTime = 0;
        this.mouseMoveTimeout = null;
        this.mouseInactivityThreshold = 500; // 毫秒，鼠标不活动阈值
        
        // 撤销功能 - 保存原始状态
        this.originalStates = new Map(); // 存储每个图层的原始状态
    }
    
    // 保存图层的原始状态
    saveOriginalState(layer) {
        if (!layer || !layer.image) return;
        
        const layerId = this.getLayerId(layer);
        if (this.originalStates.has(layerId)) {
            return; // 已经保存过原始状态
        }
        
        console.log("保存图层原始状态:", layerId);
        
        // 保存原始图像和遮罩
        const originalState = {
            image: layer.image,
            mask: layer.mask ? new Float32Array(layer.mask) : null,
            maskCanvas: layer.maskCanvas,
            timestamp: Date.now()
        };
        
        this.originalStates.set(layerId, originalState);
    }
    
    // 获取图层唯一ID
    getLayerId(layer) {
        // 使用图层在数组中的索引和一些属性来生成唯一ID
        const index = this.canvas.layers.indexOf(layer);
        return `layer_${index}_${layer.x}_${layer.y}_${layer.width}_${layer.height}`;
    }
    
    // 恢复图层到原始状态
    restoreOriginalState(layer) {
        if (!layer) return false;
        
        const layerId = this.getLayerId(layer);
        const originalState = this.originalStates.get(layerId);
        
        if (!originalState) {
            console.log("没有找到原始状态:", layerId);
            return false;
        }
        
        console.log("恢复图层到原始状态:", layerId);
        
        // 恢复原始图像
        layer.image = originalState.image;
        
        // 恢复原始遮罩
        if (originalState.mask) {
            layer.mask = new Float32Array(originalState.mask);
            layer.maskCanvas = originalState.maskCanvas;
        } else {
            // 移除遮罩
            delete layer.mask;
            if (layer.maskCanvas) {
                delete layer.maskCanvas;
            }
        }
        
        // 重新渲染
        this.canvas.render();
        
        // 保存到服务器并更新节点
        this.canvas.saveToServer(this.canvas.widget.value).then(() => {
            if (this.canvas.node) {
                this.canvas.node.setDirtyCanvas(true);
                if (typeof app !== 'undefined') {
                    app.graph.runStep();
                }
            }
        });
        
        return true;
    }
    
    // 清理过期的原始状态（可选，防止内存泄漏）
    cleanupOldStates(maxAge = 300000) { // 5分钟
        const now = Date.now();
        for (const [layerId, state] of this.originalStates.entries()) {
            if (now - state.timestamp > maxAge) {
                this.originalStates.delete(layerId);
                console.log("清理过期状态:", layerId);
            }
        }
    }
    
    // 更新画布大小
    updateCanvasSize(width, height) {
        // 如果尺寸没有变化，不需要重新创建
        if (this.tempCanvas.width === width && this.tempCanvas.height === height) {
            return;
        }
        
        // 设置临时画布大小
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;
        
        // 对于大尺寸画布，使用更高效的渲染设置
        if (width * height > 1000000) { // 例如 1000x1000 以上
            this.tempCtx.imageSmoothingEnabled = false; // 禁用抗锯齿提高性能
            this.pointThrottleInterval = 15; // 增加点采样间隔
            this.minPointDistance = 8; // 增加最小点距离
        } else {
            this.tempCtx.imageSmoothingEnabled = true;
            this.pointThrottleInterval = 10;
            this.minPointDistance = 5;
        }
    }
    
    // 启用/禁用套索工具
    toggle(active) {
        // 检查是否有选中的有效图层
        const selectedLayer = this.canvas.selectedLayer;
        if (active && (!selectedLayer || !selectedLayer.image)) {
            console.log("请先选择一个图层再使用套索工具");
            return false;
        }
        
        // 如果当前正在绘制且要关闭工具，先应用遮罩
        if (this.isActive && !active && this.isDrawing && this.points.length > this.minPointsForValidPath) {
            this.completeSelection();
            this.isDrawing = false;
        }
        // 如果有临时遮罩并且要关闭工具，确保应用遮罩
        else if (this.isActive && !active && this.hasTempMask && this.targetLayer) {
            // 这里可以执行自定义逻辑来确保遮罩被应用，如果需要的话
            this.hasTempMask = false;
        }
        
        // 如果正在关闭套索工具，且目标图层有遮罩，则合并遮罩到图像
        if (this.isActive && !active && this.targetLayer && this.targetLayer.mask) {
            this.mergeLayerMask(this.targetLayer);
        }
        
        this.isActive = active;
        if (active) {
            // 记录当前作用的目标图层
            this.targetLayer = this.canvas.selectedLayer;
            // 保存目标图层的原始状态
            this.saveOriginalState(this.targetLayer);
            // 重置路径和点
            this.clearPath();
        } else {
            // 清除路径和点
            this.clearPath();
            // 保存当前作用的目标图层（这样在切换到其他图层时不会丢失）
            this.targetLayer = null;
        }
        
        // 清除任何待处理的超时
        if (this.mouseMoveTimeout) {
            clearTimeout(this.mouseMoveTimeout);
            this.mouseMoveTimeout = null;
        }
        
        return this.isActive;
    }
    
    // 清除套索路径
    clearPath() {
        this.path = new Path2D();
        this.points = [];
        this.lastPoint = null;
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        
        // 取消任何待处理的渲染请求
        if (this.renderRequestId) {
            cancelAnimationFrame(this.renderRequestId);
            this.renderRequestId = null;
        }
        this.pendingRender = false;
        
        return true;
    }
    
    // 设置套索模式
    setMode(mode) {
        if (['new', 'add', 'subtract', 'restore'].includes(mode)) {
            this.mode = mode;
            
            // 如果选择恢复模式，立即执行恢复操作
            if (mode === 'restore' && this.targetLayer) {
                if (this.restoreOriginalState(this.targetLayer)) {
                    console.log("已恢复到原始状态");
                } else {
                    console.log("无法恢复：没有保存的原始状态");
                }
                // 恢复后重置模式为新建
                this.mode = 'new';
                // 更新UI中的选择器
                const modeSelect = this.canvas.lassoModeSelect;
                if (modeSelect) {
                    modeSelect.value = 'new';
                }
            }
            
            return true;
        }
        return false;
    }
    
    // 开始绘制
    startDrawing(x, y) {
        if (!this.isActive) return false;
        
        // 确保有选中的有效图层
        if (!this.targetLayer || !this.targetLayer.image) {
            console.log("目标图层无效，无法使用套索工具");
            return false;
        }
        
        // 确保已保存原始状态
        this.saveOriginalState(this.targetLayer);
        
        this.isDrawing = true;
        this.path = new Path2D();
        this.points = [{x, y}];
        this.lastPoint = {x, y};
        this.path.moveTo(x, y);
        this.lastPointTime = Date.now();
        this.lastMouseMoveTime = Date.now();
        
        // 重置防止意外合并的状态
        if (this.mouseMoveTimeout) {
            clearTimeout(this.mouseMoveTimeout);
        }
        
        return true;
    }
    
    // 计算两点之间的距离
    calculateDistance(point1, point2) {
        return Math.sqrt(
            Math.pow(point2.x - point1.x, 2) + 
            Math.pow(point2.y - point1.y, 2)
        );
    }
    
    // 绘制过程
    continueDrawing(x, y) {
        if (!this.isActive || !this.isDrawing) return false;
        
        const now = Date.now();
        this.lastMouseMoveTime = now;
        
        // 清除任何现有的超时
        if (this.mouseMoveTimeout) {
            clearTimeout(this.mouseMoveTimeout);
        }
        
        // 设置新的超时，如果鼠标停止移动超过阈值时间，自动完成选择
        this.mouseMoveTimeout = setTimeout(() => {
            if (this.isDrawing && this.points.length > this.minPointsForValidPath) {
                console.log("检测到鼠标不活动，自动完成选择");
                this.endDrawing();
            }
        }, this.mouseInactivityThreshold);
        
        // 点采样 - 基于时间和距离
        if (this.lastPoint && 
            (now - this.lastPointTime < this.pointThrottleInterval || 
             this.calculateDistance(this.lastPoint, {x, y}) < this.minPointDistance)) {
            return true; // 跳过这个点，但返回true表示继续绘制
        }
        
        // 更新最后点的时间和位置
        this.lastPointTime = now;
        this.lastPoint = {x, y};
        
        // 添加点并更新路径
        this.path.lineTo(x, y);
        this.points.push({x, y});
        
        // 使用请求动画帧优化渲染
        if (!this.pendingRender) {
            this.pendingRender = true;
            this.renderRequestId = requestAnimationFrame(() => {
                this.drawPreview();
                this.pendingRender = false;
                this.renderRequestId = null;
            });
        }
        
        this.hasTempMask = true; // 标记有临时遮罩需要应用
        return true;
    }
    
    // 结束绘制
    endDrawing() {
        if (!this.isActive || !this.isDrawing) return false;
        
        // 清除鼠标超时
        if (this.mouseMoveTimeout) {
            clearTimeout(this.mouseMoveTimeout);
            this.mouseMoveTimeout = null;
        }
        
        this.isDrawing = false;
        
        // 只有当点数足够时才完成选择
        if (this.points.length > this.minPointsForValidPath) {
            // 确保路径闭合
            if (this.lastPoint && this.points[0]) {
                this.path.lineTo(this.points[0].x, this.points[0].y);
            }
            
            // 完成最后一次渲染
            if (this.renderRequestId) {
                cancelAnimationFrame(this.renderRequestId);
                this.renderRequestId = null;
            }
            this.drawPreview(true); // 强制立即渲染
            
            // 应用选择
            this.completeSelection();
            this.hasTempMask = false; // 已经应用了遮罩，重置标记
            return true;
        } else {
            // 点数不够，清除路径
            this.clearPath();
            return false;
        }
    }
    
    // 绘制预览
    drawPreview(forceRender = false) {
        // 确保有选中的有效图层
        if (!this.targetLayer || !this.targetLayer.image) return;
        
        // 清除临时画布
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        
        // 如果有现有蒙版且不是新建模式，先绘制现有蒙版
        if (this.targetLayer.mask && this.mode !== 'new') {
            this.drawExistingMask();
        }
        
        // 设置套索路径样式
        this.tempCtx.strokeStyle = '#00ff00';
        this.tempCtx.lineWidth = 1;
        this.tempCtx.setLineDash([5, 5]);
        
        // 创建并闭合套索路径
        const lassoPath = new Path2D(this.path);
        if (this.points.length > 2) {
            // 只在结束绘制时闭合路径，否则保持开放状态
            if (!this.isDrawing || forceRender) {
                lassoPath.closePath();
            }
        }
        
        // 根据不同模式设置不同的预览效果
        this.tempCtx.save();
        switch (this.mode) {
            case 'new':
                // 新建模式：简单显示选区
                this.tempCtx.fillStyle = 'rgba(0, 255, 0, 0.2)';
                this.tempCtx.fill(lassoPath);
                break;
                
            case 'add':
                // 添加模式：显示绿色半透明
                this.tempCtx.fillStyle = 'rgba(0, 255, 0, 0.3)';
                this.tempCtx.globalCompositeOperation = 'source-over';
                this.tempCtx.fill(lassoPath);
                break;
                
            case 'subtract':
                // 减去模式：显示红色半透明
                this.tempCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                this.tempCtx.globalCompositeOperation = 'source-over';
                this.tempCtx.fill(lassoPath);
                break;
        }
        
        // 绘制路径轮廓
        this.tempCtx.strokeStyle = this.mode === 'subtract' ? '#ff0000' : '#00ff00';
        this.tempCtx.stroke(lassoPath);
        this.tempCtx.restore();
        
        // 触发画布重绘
        this.canvas.render();
    }
    
    // 绘制现有蒙版
    drawExistingMask() {
        const layer = this.targetLayer;
        if (!layer || !layer.mask) return;
        
        // 使用缓存的maskCanvas如果存在
        if (layer.maskCanvas) {
            this.tempCtx.save();
            this.tempCtx.globalAlpha = 0.5;
            this.tempCtx.drawImage(
                layer.maskCanvas,
                layer.x,
                layer.y,
                layer.width,
                layer.height
            );
            this.tempCtx.restore();
            return;
        }
        
        // 否则创建新的maskCanvas
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = layer.width;
        maskCanvas.height = layer.height;
        const maskCtx = maskCanvas.getContext('2d');
        
        // 将Float32Array蒙版数据转换为ImageData - 使用更高效的批处理
        const imageData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
        const mask = layer.mask;
        const data = imageData.data;
        
        // 批量处理数据
        const length = Math.min(mask.length, data.length / 4);
        for (let i = 0; i < length; i++) {
            const index = i * 4;
            const alpha = Math.round(mask[i] * 255);
            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = 255;
            data[index + 3] = alpha;
        }
        
        maskCtx.putImageData(imageData, 0, 0);
        
        // 缓存maskCanvas
        layer.maskCanvas = maskCanvas;
        
        // 将蒙版绘制到临时画布上
        this.tempCtx.save();
        this.tempCtx.globalAlpha = 0.5;
        this.tempCtx.drawImage(
            maskCanvas,
            layer.x,
            layer.y,
            layer.width,
            layer.height
        );
        this.tempCtx.restore();
    }
    
    // 检查图层选择变化并更新目标图层
    checkLayerChange() {
        // 如果工具是激活的，且目标图层与当前选中图层不同，则禁用套索工具
        if (this.isActive && this.targetLayer !== this.canvas.selectedLayer) {
            // 如果当前还有绘制中的遮罩，先完成它
            if (this.isDrawing && this.points.length > this.minPointsForValidPath) {
                this.completeSelection();
            }
            
            // 如果目标图层有遮罩，合并遮罩到图像
            if (this.targetLayer && this.targetLayer.mask) {
                this.mergeLayerMask(this.targetLayer);
            }
            
            console.log("选中的图层已更改，套索工具已自动关闭");
            this.toggle(false);
            return true;
        }
        
        // 如果图层没有变化，但是选择了新图层，保存其原始状态
        if (this.isActive && this.canvas.selectedLayer && this.canvas.selectedLayer !== this.targetLayer) {
            this.targetLayer = this.canvas.selectedLayer;
            this.saveOriginalState(this.targetLayer);
        }
        
        return false;
    }
    
    // 完成选择并应用蒙版
    completeSelection() {
        // 确保使用存储的目标图层，而不是当前选中的图层
        const layer = this.targetLayer;
        if (!layer || !layer.image) return;
        
        console.log(`完成选择，处理 ${this.points.length} 个点`);
        
        try {
            // 创建临时画布，大小与图层一致
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = layer.width;
            tempCanvas.height = layer.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            
            // 创建用于变换的临时画布
            const transformCanvas = document.createElement('canvas');
            transformCanvas.width = this.canvas.width;
            transformCanvas.height = this.canvas.height;
            const transformCtx = transformCanvas.getContext('2d', { willReadFrequently: true });
            
            // 绘制套索路径
            transformCtx.save();
            transformCtx.fillStyle = '#ffffff';
            const closedPath = new Path2D(this.path);
            closedPath.closePath();
            transformCtx.fill(closedPath);
            transformCtx.restore();
            
            // 获取变换后的蒙版数据
            const transformedMask = transformCtx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            
            // 将蒙版转换到图层坐标系
            tempCtx.save();
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // 应用反向变换
            const centerX = layer.x + layer.width/2;
            const centerY = layer.y + layer.height/2;
            
            tempCtx.translate(tempCanvas.width/2, tempCanvas.height/2);
            if (layer.rotation) {
                tempCtx.rotate(-layer.rotation * Math.PI / 180);
            }
            
            // 计算缩放比例
            const scaleX = tempCanvas.width / layer.width;
            const scaleY = tempCanvas.height / layer.height;
            tempCtx.scale(scaleX, scaleY);
            
            // 绘制变换后的蒙版
            tempCtx.drawImage(
                transformCanvas,
                -this.canvas.width/2 + (this.canvas.width/2 - centerX),
                -this.canvas.height/2 + (this.canvas.height/2 - centerY),
                this.canvas.width,
                this.canvas.height
            );
            tempCtx.restore();
            
            // 获取图层坐标系下的蒙版数据
            const layerMaskData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            
            // 创建或获取现有蒙版
            let currentMask;
            if (!layer.mask || this.mode === 'new') {
                // 新建模式或没有现有蒙版时，创建新的蒙版
                currentMask = new Float32Array(tempCanvas.width * tempCanvas.height).fill(0);
            } else {
                // 添加或减去模式，复制现有蒙版
                currentMask = new Float32Array(layer.mask);
            }
            
            // 合并蒙版 - 使用批处理优化
            const maskData = layerMaskData.data;
            const length = Math.min(maskData.length / 4, currentMask.length);
            
            switch (this.mode) {
                case 'new':
                    for (let i = 0; i < length; i++) {
                        currentMask[i] = maskData[i * 4 + 3] / 255;
                    }
                    break;
                case 'add':
                    for (let i = 0; i < length; i++) {
                        const newAlpha = maskData[i * 4 + 3] / 255;
                        currentMask[i] = Math.min(1, currentMask[i] + newAlpha);
                    }
                    break;
                case 'subtract':
                    for (let i = 0; i < length; i++) {
                        const newAlpha = maskData[i * 4 + 3] / 255;
                        currentMask[i] = Math.max(0, currentMask[i] - newAlpha);
                    }
                    break;
            }
            
            // 更新图层蒙版
            layer.mask = currentMask;
            
            // 创建并保存蒙版画布
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = tempCanvas.width;
            maskCanvas.height = tempCanvas.height;
            const maskCtx = maskCanvas.getContext('2d');
            
            // 将Float32Array转换为ImageData - 使用批处理
            const maskImageData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
            const imgData = maskImageData.data;
            
            for (let i = 0; i < currentMask.length; i++) {
                const index = i * 4;
                const alpha = Math.round(currentMask[i] * 255);
                imgData[index] = 255;
                imgData[index + 1] = 255;
                imgData[index + 2] = 255;
                imgData[index + 3] = alpha;
            }
            
            maskCtx.putImageData(maskImageData, 0, 0);
            layer.maskCanvas = maskCanvas;
            
            console.log("选择完成，蒙版已应用");
        } catch (error) {
            console.error("套索工具应用选择时出错:", error);
        }
        
        // 清除临时路径
        this.clearPath();
        
        // 强制重新渲染
        this.canvas.render();
    }
    
    // 清除当前图层的遮罩/透明度
    clearMask() {
        // 先尝试使用目标图层，如果不存在则使用当前选中的图层
        const layer = this.targetLayer || this.canvas.selectedLayer;
        if (!layer || !layer.image) return false;
        
        // 检查是否有旧式mask属性
        if (layer.mask) {
            // 移除遮罩数据
            delete layer.mask;
            
            // 移除遮罩画布
            if (layer.maskCanvas) {
                delete layer.maskCanvas;
            }
            
            // 重新渲染画布
            this.canvas.render();
            
            // 保存到服务器并更新节点
            this.canvas.saveToServer(this.canvas.widget.value).then(() => {
                if (this.canvas.node) {
                    this.canvas.node.setDirtyCanvas(true);
                    if (typeof app !== 'undefined') {
                        app.graph.runStep();
                    }
                }
            });
            
            return true;
        }
        
        // 处理图像中的透明度
        // 创建临时画布，用于移除图像透明度
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = layer.width;
        tempCanvas.height = layer.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 首先设置白色背景（可选）
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 绘制图像
        tempCtx.drawImage(layer.image, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // 获取图像数据
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        
        // 移除透明度，将所有像素的Alpha通道设置为255（完全不透明）
        const data = imageData.data;
        for (let i = 3; i < data.length; i += 4) {
            data[i] = 255; // 设置为完全不透明
        }
        
        // 将修改后的图像数据放回画布
        tempCtx.putImageData(imageData, 0, 0);
        
        // 创建新图像对象
        const newImage = new Image();
        newImage.onload = () => {
            // 替换图层的图像
            layer.image = newImage;
            
            // 重新渲染画布
            this.canvas.render();
            
            // 保存到服务器并更新节点
            this.canvas.saveToServer(this.canvas.widget.value).then(() => {
                if (this.canvas.node) {
                    this.canvas.node.setDirtyCanvas(true);
                    if (typeof app !== 'undefined') {
                        app.graph.runStep();
                    }
                }
            });
        };
        
        // 将画布转换为数据URL并加载到新图像
        newImage.src = tempCanvas.toDataURL('image/png');
        
        return true;
    }
    
    // 获取临时画布，用于在主画布上绘制
    getTempCanvas() {
        return this.tempCanvas;
    }
    
    // 将图层遮罩合并到图像的Alpha通道中
    mergeLayerMask(layer) {
        if (!layer || !layer.image || !layer.mask) return;
        
        // 创建一个新的画布用于合并图像和遮罩
        const mergedCanvas = document.createElement('canvas');
        mergedCanvas.width = layer.width;
        mergedCanvas.height = layer.height;
        const mergedCtx = mergedCanvas.getContext('2d');
        
        // 首先绘制原始图像
        mergedCtx.drawImage(
            layer.image,
            0, 0,
            layer.width, layer.height
        );
        
        // 获取图像数据以修改alpha通道
        const imageData = mergedCtx.getImageData(0, 0, layer.width, layer.height);
        
        // 应用遮罩到alpha通道 - 使用批处理优化
        const data = imageData.data;
        const mask = layer.mask;
        const length = Math.min(mask.length, data.length / 4);
        
        for (let i = 0; i < length; i++) {
            const pixelIndex = i * 4 + 3; // alpha通道索引
            // 确保遮罩值在0-1范围内
            const maskValue = Math.max(0, Math.min(1, mask[i]));
            // 使用遮罩值和原始alpha值相乘，维持透明度
            data[pixelIndex] = Math.round(maskValue * data[pixelIndex]);
        }
        
        // 将修改后的图像数据放回画布
        mergedCtx.putImageData(imageData, 0, 0);
        
        // 创建一个新的Image对象并设置为带Alpha通道的图像
        const newImage = new Image();
        newImage.onload = () => {
            // 替换图层的原始图像
            layer.image = newImage;
            
            // 清除遮罩数据，因为它已经合并到图像中
            delete layer.mask;
            if (layer.maskCanvas) {
                delete layer.maskCanvas;
            }
            
            // 强制重新渲染
            this.canvas.render();
            
            // 保存到服务器并更新节点
            this.canvas.saveToServer(this.canvas.widget.value).then(() => {
                if (this.canvas.node) {
                    this.canvas.node.setDirtyCanvas(true);
                    if (typeof app !== 'undefined') {
                        app.graph.runStep();
                    }
                }
            });
        };
        
        // 将合并后的画布转换为数据URL并加载到新图像
        newImage.src = mergedCanvas.toDataURL('image/png');
    }
} 