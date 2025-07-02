/**
 * PenTool.js - 轻量级钢笔路径工具
 * 不依赖外部Paper.js库，使用原生Canvas API实现基础钢笔功能
 */

export class PenTool {
    constructor(canvas) {
        this.canvas = canvas;
        this.isActive = false;
        this.currentPath = null;
        this.points = [];
        this.isDrawing = false;
        this.paths = []; // 存储所有完成的路径
        this.strokeColor = '#ff0000';
        this.strokeWidth = 2;
        this.savedImageData = null; // 保存画布状态用于预览
        
        // 新增：控制点编辑相关
        this.editMode = false; // 编辑模式
        this.selectedPoint = null; // 选中的点
        this.selectedControlPoint = null; // 选中的控制点
        this.dragOffset = { x: 0, y: 0 }; // 拖拽偏移
        this.isDragging = false; // 是否正在拖拽
        
        // 新增：路径状态管理
        this.pathState = 'ready'; // ready, drawing, paused, editing, broken
        this.pausedPath = null; // 暂停的路径
        
        // 新增：多路径管理系统
        this.brokenPaths = []; // 存储断开状态的路径
        this.pathCounter = 0; // 路径计数器
        this.currentBlendMode = 'add'; // 当前遮罩合成模式：'add', 'subtract', 'intersect', 'replace'
        this.activePath = null; // 当前激活的路径
        
        // 新增：绘制模式的动态控制
        this.isPreviewActive = false; // 预览线是否激活
        this.drawingFromPoint = null; // 当前绘制起始点
        this.lastClickTime = 0;
        this.doubleClickDelay = 300; // 双击检测时间间隔
        
        // 新增：专业矢量软件风格的拖动绘制
        this.mouseDownPos = null; // 鼠标按下位置
        this.isDragCreating = false; // 是否正在拖动创建控制点
        this.dragThreshold = 3; // 拖动检测阈值（像素）
        this.currentDragPoint = null; // 当前拖动创建的点
        this.tempControlPoint = null; // 临时控制点
        
        // 新增：图层锁定管理
        this.lockedLayer = null; // 锁定的图层
        this.originalLayerSelectEnabled = true; // 原始图层选择状态
        
        // 新增：临时画布系统（参考套索工具）
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        
        // 初始化临时画布大小
        this.updateCanvasSize(canvas.width, canvas.height);
        
        this.init();
    }
    
    init() {
        // 绑定事件
        this.bindEvents();
        console.log('PenTool initialized with advanced features');
    }
    
    activate() {
        this.isActive = true;
        this.canvas.canvas.style.cursor = 'crosshair';
        
        // 锁定当前选中的图层
        this.lockCurrentLayer();
        
        console.log('🖊️ Pen tool activated, layer locked');
        
        // 显示激活指示器和使用提示
        this.showActivationIndicator();
    }
    
    deactivate() {
        this.isActive = false;
        this.canvas.canvas.style.cursor = 'default';
        
        // 如果有未完成的路径或断开的路径，自动完成并应用遮罩
        const hasActivePaths = (this.currentPath && this.currentPath.points.length > 0) || 
                              this.brokenPaths.length > 0 || 
                              this.paths.length > 0;
        
        if (hasActivePaths) {
            console.log('🖊️ Auto-finishing paths on pen tool deactivation');
            this.finishPath();
        }
        
        this.exitEditMode();
        
        // 解锁图层
        this.unlockLayer();
        
        // 清除任何预览状态
        this.canvas.render();
        console.log('🖊️ Pen tool deactivated, layer unlocked, mask applied');
    }
    
    // 新增：锁定当前图层
    lockCurrentLayer() {
        if (this.canvas.selectedLayer && this.canvas.selectedLayer.image) {
            this.lockedLayer = this.canvas.selectedLayer;
            
            // 使用简单有效的事件拦截方案
            this.interceptCanvasEvents();
            
            console.log('🔒 Layer locked for pen tool:', this.lockedLayer);
        } else {
            alert('请先选择一个图像图层再激活钢笔工具');
            // 如果没有选中图层，取消激活
            this.isActive = false;
            return false;
        }
        return true;
    }
    
    // 新增：解锁图层
    unlockLayer() {
        if (this.lockedLayer) {
            // 恢复Canvas的正常事件处理
            this.restoreCanvasEvents();
            
            console.log('🔓 Layer unlocked:', this.lockedLayer);
            this.lockedLayer = null;
        }
        
        // 清除临时画布
        this.clearTempCanvas();
    }
    
    // 新增：拦截Canvas事件（简化版）
    interceptCanvasEvents() {
        // 保存Canvas原始的setSelectedLayer方法
        this.originalSetSelectedLayer = this.canvas.setSelectedLayer.bind(this.canvas);
        
        // 临时替换setSelectedLayer方法
        this.canvas.setSelectedLayer = (layer) => {
            // 如果钢笔工具激活且请求选择的不是锁定图层，忽略
            if (this.isActive && layer !== this.lockedLayer && layer !== null) {
                console.log('🚫 Layer selection blocked by pen tool');
                return;
            }
            
            // 允许选择锁定图层或清除选择
            this.originalSetSelectedLayer(layer);
        };
        
        console.log('🛡️ Canvas events intercepted - pen tool protected');
    }
    
    // 新增：恢复Canvas事件
    restoreCanvasEvents() {
        if (this.originalSetSelectedLayer) {
            this.canvas.setSelectedLayer = this.originalSetSelectedLayer;
            this.originalSetSelectedLayer = null;
        }
        
        console.log('✅ Canvas events restored');
    }
    
    // 新增：清除临时画布
    clearTempCanvas() {
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }
    
    // 新增：绘制路径到临时画布
    drawToTempCanvas() {
        // 清除临时画布
        this.clearTempCanvas();
        
        // 绘制所有完成的路径
        this.paths.forEach(path => {
            this.drawSmoothPath(this.tempCtx, path, null, null, this.editMode);
        });
        
        // 绘制所有断开的路径，用不同颜色表示不同混合模式
        this.brokenPaths.forEach((path, index) => {
            // 根据混合模式设置颜色
            const blendModeColors = {
                'add': '#00ff00',      // 绿色 - 添加
                'subtract': '#ff0000', // 红色 - 减去
                'intersect': '#0080ff',// 蓝色 - 相交
                'replace': '#ff8000'   // 橙色 - 替换
            };
            
            const originalColor = path.strokeColor;
            path.strokeColor = blendModeColors[path.blendMode] || originalColor;
            
            // 绘制断开路径，用半透明显示
            this.tempCtx.save();
            this.tempCtx.globalAlpha = 0.7;
            this.drawSmoothPath(this.tempCtx, path, null, null, this.editMode);
            this.tempCtx.restore();
            
            // 恢复原始颜色
            path.strokeColor = originalColor;
            
            // 高亮端点，表示可以双击续连
            this.highlightEndpoints(this.tempCtx, path);
        });
        
        // 绘制当前路径
        if (this.currentPath) {
            // 当前路径用当前混合模式的颜色
            const blendModeColors = {
                'add': '#00ff00',
                'subtract': '#ff0000', 
                'intersect': '#0080ff',
                'replace': '#ff8000'
            };
            
            const originalColor = this.currentPath.strokeColor;
            this.currentPath.strokeColor = blendModeColors[this.currentBlendMode] || originalColor;
            
            this.drawSmoothPath(this.tempCtx, this.currentPath, null, null, this.editMode);
            
            // 恢复原始颜色
            this.currentPath.strokeColor = originalColor;
        }
    }
    
    // 新增：高亮路径端点
    highlightEndpoints(ctx, path) {
        if (!path.points || path.points.length === 0) return;
        
        ctx.save();
        
        // 端点样式
        ctx.fillStyle = '#ffff00'; // 黄色
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        
        // 绘制首端点
        const firstPoint = path.points[0];
        ctx.beginPath();
        ctx.arc(firstPoint.x, firstPoint.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // 绘制尾端点（如果不是同一个点）
        if (path.points.length > 1) {
            const lastPoint = path.points[path.points.length - 1];
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    // 修改：渲染预览方法
    renderPreview(previewX = null, previewY = null) {
        console.log('🖊️ Rendering preview to temp canvas');
        
        // 清除临时画布
        this.clearTempCanvas();
        
        // 绘制所有完成的路径
        this.paths.forEach((path, index) => {
            console.log(`🖊️ Drawing completed path ${index}:`, path);
            this.drawSmoothPath(this.tempCtx, path, null, null, this.editMode);
        });
        
        // 绘制当前正在编辑的路径
        if (this.currentPath && this.currentPath.points.length > 0) {
            console.log('🖊️ Drawing current path with', this.currentPath.points.length, 'points');
            // 只有在预览激活且非编辑模式时才显示预览线
            const showPreview = this.isPreviewActive && !this.editMode;
            this.drawSmoothPath(this.tempCtx, this.currentPath, showPreview ? previewX : null, showPreview ? previewY : null, this.editMode);
        } else {
            console.log('🖊️ No current path to draw');
        }
        
        // 触发Canvas重绘以显示临时画布
        this.canvas.render();
    }
    
    showActivationIndicator() {
        const ctx = this.canvas.ctx;
        
        // 保存当前画布状态
        const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制简单的激活提示
        ctx.save();
        ctx.fillStyle = '#f3db15';
        ctx.font = 'bold 16px Arial';
        
        const layerName = this.lockedLayer ? this.lockedLayer.name || '图层' : '未知';
        const message = `🖊️ 钢笔工具已激活 - 图层"${layerName}"已锁定`;
        
        // 靠左显示
        const x = 10;
        const y = 20;
        
        // 直接绘制文本
        ctx.fillText(message, x, y);
        
        ctx.restore();
        
        console.log('🖊️ Activation indicator with layer lock info shown');
        
        // 2秒后恢复原始画布状态
        setTimeout(() => {
            if (this.isActive) {
                ctx.putImageData(imageData, 0, 0);
            }
        }, 2000);
    }
    
    bindEvents() {
        const canvasElement = this.canvas.canvas;
        
        canvasElement.addEventListener('mousedown', (e) => {
            if (!this.isActive) return;
            // Canvas事件已被禁用，不需要阻止冒泡
            this.handleMouseDown(e);
        });
        
        canvasElement.addEventListener('mousemove', (e) => {
            if (!this.isActive) return;
            this.handleMouseMove(e);
        });
        
        canvasElement.addEventListener('mouseup', (e) => {
            if (!this.isActive) return;
            this.handleMouseUp(e);
        });
        
        canvasElement.addEventListener('dblclick', (e) => {
            if (!this.isActive) return;
            
            // Canvas事件已被禁用，不需要阻止冒泡
            
            if (this.editMode) {
                // 编辑模式：保持原有的编辑功能（拖拽、选择等）
                this.handleEditModeDoubleClick(e);
            } else {
                // 绘制模式：处理动态断开/连接
                this.handleDrawModeDoubleClick(e);
            }
        });
        
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (!this.isActive) return;
            
            switch (e.key) {
                case 'Escape':
                    this.cancelPath();
                    break;
                case 'Enter':
                    this.finishPath();
                    break;
                case ' ': // 空格键
                    e.preventDefault(); // 防止页面滚动
                    this.togglePausePath();
                    break;
                case 'e':
                case 'E':
                    this.toggleEditMode();
                    break;
                case 'd':
                case 'D':
                    e.preventDefault(); // 防止浏览器默认行为
                    this.handleDeleteNode();
                    break;
            }
        });
    }
    
    handleMouseDown(e) {
        const coords = this.getMouseCoords(e);
        console.log('🖊️ Mouse down event, coords:', coords, 'state:', this.pathState);
        
        // 记录鼠标按下位置，用于拖动检测
        this.mouseDownPos = { x: coords.x, y: coords.y };
        this.isDragCreating = false;
        this.currentDragPoint = null;
        this.tempControlPoint = null;
        
        if (this.editMode) {
            // 编辑模式：检查是否点击了控制点或锚点
            this.handleEditModeClick(coords, e);
        } else {
            // 绘制模式：准备创建新点，但等待确认是点击还是拖动
            this.preparePointCreation(coords, e);
        }
        
        this.isDrawing = true;
    }
    
    // 新增：准备点创建（等待确认是点击还是拖动）
    preparePointCreation(coords, e) {
        const isCtrlPressed = e.ctrlKey || e.metaKey;
        
        if (this.pathState === 'ready' || (this.pathState === 'drawing' && this.isPreviewActive)) {
            if (!this.currentPath) {
                // 准备开始新路径，但还不确定是直线点还是曲线点
                this.currentDragPoint = {
                    x: coords.x,
                    y: coords.y,
                    type: 'anchor',
                    cp1: null,
                    cp2: null,
                    isCtrlPressed: isCtrlPressed
                };
            } else if (this.isPreviewActive) {
                // 准备添加新点到当前路径
                this.currentDragPoint = {
                    x: coords.x,
                    y: coords.y,
                    type: 'anchor',
                    cp1: null,
                    cp2: null,
                    isCtrlPressed: isCtrlPressed
                };
            }
        } else if (this.pathState === 'paused') {
            // 继续绘制暂停的路径
            this.resumePath();
            this.currentDragPoint = {
                x: coords.x,
                y: coords.y,
                type: 'anchor',
                cp1: null,
                cp2: null,
                isCtrlPressed: isCtrlPressed
            };
            this.pathState = 'drawing';
            this.isPreviewActive = true;
        } else if (this.pathState === 'broken' && this.currentPath) {
            // 从断开状态恢复绘制 - 重新激活预览模式
            console.log('🖊️ Resuming drawing from broken state');
            this.pathState = 'drawing';
            this.isPreviewActive = true;
            
            // 保存画布状态用于预览
            if (!this.savedImageData) {
                this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            }
            
            // 准备添加新点
            this.currentDragPoint = {
                x: coords.x,
                y: coords.y,
                type: 'anchor',
                cp1: null,
                cp2: null,
                isCtrlPressed: isCtrlPressed
            };
            
            // 立即开始预览
            this.renderPreview();
        }
    }
    
    handleMouseMove(e) {
        const coords = this.getMouseCoords(e);
        
        if (this.editMode && this.isDragging) {
            // 编辑模式：拖拽控制点或锚点
            this.handleDragEdit(coords);
        } else if (this.isDrawing && this.mouseDownPos && this.currentDragPoint && !this.editMode) {
            // 绘制模式：检测是否开始拖动创建控制点
            this.handlePotentialDragCreation(coords);
        } else if (this.currentPath && this.pathState === 'drawing' && this.isPreviewActive && !this.editMode && !this.isDragCreating) {
            // 绘制模式且预览激活：更新预览（仅在不拖动时）
            this.updatePathPreview(coords.x, coords.y);
        } else if (this.currentPath && this.pathState === 'broken' && !this.editMode && !this.isDrawing) {
            // 断开状态下也显示预览线，提示用户可以点击继续
            this.updatePathPreview(coords.x, coords.y);
        }
    }
    
    // 新增：处理潜在的拖动创建控制点
    handlePotentialDragCreation(coords) {
        if (!this.mouseDownPos || !this.currentDragPoint) return;
        
        // 计算拖动距离
        const dragDistance = Math.sqrt(
            Math.pow(coords.x - this.mouseDownPos.x, 2) + 
            Math.pow(coords.y - this.mouseDownPos.y, 2)
        );
        
        // 如果拖动距离超过阈值，开始拖动创建控制点
        if (dragDistance > this.dragThreshold && !this.isDragCreating) {
            this.isDragCreating = true;
            console.log('🖊️ Started drag creation mode');
            
            // 创建控制点
            this.tempControlPoint = {
                x: coords.x,
                y: coords.y
            };
            
            // 应用控制点到当前拖动点
            this.applyDragControlPoints(this.currentDragPoint, this.tempControlPoint);
            
            // 立即创建点并开始预览
            this.commitDragPoint();
        } else if (this.isDragCreating) {
            // 继续拖动，更新控制点
            this.tempControlPoint = {
                x: coords.x,
                y: coords.y
            };
            
            // 更新最后一个点的控制点
            this.updateLastPointControlPoints(this.tempControlPoint);
            
            // 实时更新预览
            this.renderPreview();
        }
    }
    
    // 新增：应用拖动控制点
    applyDragControlPoints(point, controlPoint) {
        // 计算从锚点到控制点的向量
        const dx = controlPoint.x - point.x;
        const dy = controlPoint.y - point.y;
        
        // 创建对称的控制点
        point.cp1 = {
            x: point.x - dx,
            y: point.y - dy
        };
        
        point.cp2 = {
            x: point.x + dx,
            y: point.y + dy
        };
        
        console.log('🖊️ Applied drag control points:', point);
    }
    
    // 新增：提交拖动点
    commitDragPoint() {
        if (!this.currentDragPoint) return;
        
        if (!this.currentPath) {
            // 开始新路径
            this.startNewPathWithPoint(this.currentDragPoint);
        } else {
            // 添加点到现有路径
            this.addPointToCurrentPath(this.currentDragPoint);
        }
    }
    
    // 新增：用指定点开始新路径
    startNewPathWithPoint(point) {
        // 保存当前画布状态用于预览
        this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        this.currentPath = {
            points: [{ ...point }], // 深拷贝点
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            closed: false
        };
        
        this.pathState = 'drawing';
        this.isPreviewActive = true;
        
        console.log('🖊️ Started new path with point:', point);
        this.renderPreview();
    }
    
    // 新增：添加点到当前路径
    addPointToCurrentPath(point) {
        if (!this.currentPath) return;
        
        // 深拷贝点并添加到路径
        this.currentPath.points.push({ ...point });
        
        console.log('🖊️ Added point to current path:', point);
        this.renderPreview();
    }
    
    // 新增：更新最后一个点的控制点
    updateLastPointControlPoints(controlPoint) {
        if (!this.currentPath || this.currentPath.points.length === 0) return;
        
        const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
        
        // 计算从锚点到控制点的向量
        const dx = controlPoint.x - lastPoint.x;
        const dy = controlPoint.y - lastPoint.y;
        
        // 更新控制点
        lastPoint.cp1 = {
            x: lastPoint.x - dx,
            y: lastPoint.y - dy
        };
        
        lastPoint.cp2 = {
            x: lastPoint.x + dx,
            y: lastPoint.y + dy
        };
    }
    
    handleMouseUp(e) {
        if (this.isDrawing && !this.editMode) {
            if (this.isDragCreating) {
                // 拖动创建模式：已经创建了曲线点，无需额外操作
                console.log('🖊️ Finished drag creation of curve point');
            } else if (this.currentDragPoint) {
                // 普通点击模式：创建直线点
                console.log('🖊️ Creating straight line point');
                
                // 移除任何自动生成的控制点，创建纯直线点
                this.currentDragPoint.cp1 = null;
                this.currentDragPoint.cp2 = null;
                
                // 如果是Ctrl+点击，仍然可以创建对称控制点
                if (this.currentDragPoint.isCtrlPressed) {
                    this.createControlPointsForAnchor(this.currentDragPoint);
                }
                
                // 提交点
                this.commitDragPoint();
            }
        }
        
        // 重置状态
        this.isDrawing = false;
        this.isDragging = false;
        
        // 在编辑模式下不重置selectedPoint，以便按D键删除
        if (!this.editMode) {
            this.selectedPoint = null;
            this.selectedControlPoint = null;
        }
        
        this.mouseDownPos = null;
        this.isDragCreating = false;
        this.currentDragPoint = null;
        this.tempControlPoint = null;
    }
    
    getMouseCoords(e) {
        const rect = this.canvas.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 转换坐标到实际画布坐标
        const canvasRect = this.canvas.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / canvasRect.width;
        const scaleY = this.canvas.height / canvasRect.height;
        const actualX = x * scaleX;
        const actualY = y * scaleY;
        
        return { x: actualX, y: actualY, screen: { x, y } };
    }
    
    startNewPath(x, y, isCtrlPressed = false) {
        // 保存当前画布状态用于预览
        this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        const newPoint = {
            x: x, 
            y: y, 
            type: 'anchor',
            cp1: null, // 控制点1
            cp2: null  // 控制点2
        };
        
        // 如果是Ctrl+点击，创建带控制点的锚点
        if (isCtrlPressed) {
            this.createControlPointsForAnchor(newPoint);
        }
        
        this.currentPath = {
            points: [newPoint],
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            closed: false
        };
        
        console.log('🖊️ Started new path at:', x, y, isCtrlPressed ? '(with control points)' : '');
        this.renderPreview();
    }
    
    addPointToPath(x, y, isCtrlPressed = false) {
        if (!this.currentPath) return;
        
        const newPoint = {
            x: x,
            y: y,
            type: 'anchor',
            cp1: null,
            cp2: null
        };
        
        // 如果是Ctrl+点击，创建控制点
        if (isCtrlPressed) {
            this.createControlPointsForAnchor(newPoint);
        } else {
            // 自动生成平滑的贝塞尔控制点
            if (this.currentPath.points.length >= 2) {
                this.generateSmoothControlPoints(newPoint);
            }
        }
        
        this.currentPath.points.push(newPoint);
        console.log('🖊️ Added point to path:', x, y, isCtrlPressed ? '(with manual control points)' : '(auto smooth)');
        this.renderPreview();
    }
    
    // 新增：创建手动控制点
    createControlPointsForAnchor(point) {
        const controlDistance = 50; // 控制点距离锚点的默认距离
        
        // 创建两个对称的控制点
        point.cp1 = {
            x: point.x - controlDistance,
            y: point.y
        };
        
        point.cp2 = {
            x: point.x + controlDistance,
            y: point.y
        };
        
        console.log('🖊️ Created manual control points for anchor:', point);
    }
    
    generateSmoothControlPoints(newPoint) {
        const points = this.currentPath.points;
        const len = points.length;
        
        if (len < 2) return;
        
        const prev = points[len - 1];
        const prevPrev = points[len - 2];
        
        // 计算切线向量
        const dx1 = prev.x - prevPrev.x;
        const dy1 = prev.y - prevPrev.y;
        const dx2 = newPoint.x - prev.x;
        const dy2 = newPoint.y - prev.y;
        
        // 平滑因子
        const smoothFactor = 0.3;
        
        // 为前一个点生成控制点
        prev.cp2 = {
            x: prev.x + dx2 * smoothFactor,
            y: prev.y + dy2 * smoothFactor
        };
        
        // 为新点生成控制点
        newPoint.cp1 = {
            x: newPoint.x - dx2 * smoothFactor,
            y: newPoint.y - dy2 * smoothFactor
        };
    }
    
    updatePathPreview(x, y) {
        // 恢复之前保存的画布状态
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
        }
        // 使用主画布绘制预览
        this.renderPreview(x, y);
    }
    
    finishPath() {
        // 收集所有路径：当前路径 + 所有断开路径
        const allPathsForMask = [];
        
        // 添加当前路径
        if (this.currentPath && this.currentPath.points.length > 1) {
            // 确保当前路径有混合模式
            this.currentPath.blendMode = this.currentPath.blendMode || this.currentBlendMode;
            allPathsForMask.push(this.currentPath);
            console.log(`Adding current path to mask creation (${this.currentPath.blendMode} mode)`);
        }
        
        // 添加所有断开的路径
        this.brokenPaths.forEach(brokenPath => {
            if (brokenPath.points.length > 1) {
                allPathsForMask.push(brokenPath);
                console.log(`Adding broken path ${brokenPath.name} to mask creation (${brokenPath.blendMode} mode)`);
            }
        });
        
        if (allPathsForMask.length === 0) {
            console.log('No valid paths to create mask');
            return;
        }
        
        console.log(`Finishing paths: ${allPathsForMask.length} paths will be combined for mask creation`);
        
        // 创建多路径合成遮罩：将所有路径应用到锁定的图层作为遮罩
        if (this.lockedLayer && this.lockedLayer.image) {
            this.createMaskFromMultiplePathsWithBlending(allPathsForMask);
        } else {
            alert('锁定的图层不存在，无法创建遮罩');
            return;
        }
        
        // 重置所有路径状态
        this.currentPath = null;
        this.brokenPaths = [];
        this.pathCounter = 0;
        this.activePath = null;
        this.isDrawing = false;
        this.pathState = 'ready';
        this.pausedPath = null;
        this.isPreviewActive = false;
        this.drawingFromPoint = null;
        
        // 清除临时画布
        this.clearTempCanvas();
        
        // 重新渲染画布
        this.canvas.render();
        
        // 触发UI更新
        this.onPathStatusChange?.();
    }
    
    // 新增：从多个路径创建带混合模式的遮罩
    createMaskFromMultiplePathsWithBlending(allPaths) {
        if (!allPaths || allPaths.length === 0 || !this.lockedLayer) return;
        
        const layer = this.lockedLayer;
        
        console.log(`Creating blended mask from ${allPaths.length} pen paths for locked layer:`, layer);
        
        // 按混合模式分组路径
        const pathsByBlendMode = {
            add: allPaths.filter(p => p.blendMode === 'add'),
            subtract: allPaths.filter(p => p.blendMode === 'subtract'),
            intersect: allPaths.filter(p => p.blendMode === 'intersect'),
            replace: allPaths.filter(p => p.blendMode === 'replace')
        };
        
        console.log('Paths by blend mode:', {
            add: pathsByBlendMode.add.length,
            subtract: pathsByBlendMode.subtract.length,
            intersect: pathsByBlendMode.intersect.length,
            replace: pathsByBlendMode.replace.length
        });
        
        try {
            // 创建最终遮罩 - 从图层现有遮罩开始，如果没有则使用全白（完全显示）
            let finalMask;
            if (layer.mask) {
                // 复制现有遮罩
                finalMask = new Float32Array(layer.mask);
                console.log('Starting from existing layer mask');
            } else {
                // 如果没有现有遮罩，对于减去模式需要从全白开始
                const hasSubtractMode = pathsByBlendMode.subtract.length > 0;
                finalMask = new Float32Array(layer.width * layer.height).fill(hasSubtractMode ? 1 : 0);
                console.log(hasSubtractMode ? 'Starting from full white mask (for subtract mode)' : 'Starting from empty mask');
            }
            
            // 1. 处理替换模式（清空并添加）
            if (pathsByBlendMode.replace.length > 0) {
                console.log('Processing replace mode paths...');
                const replaceMask = this.createMaskFromPathGroup(pathsByBlendMode.replace, layer);
                finalMask = replaceMask;
            }
            
            // 2. 处理添加模式
            if (pathsByBlendMode.add.length > 0) {
                console.log('Processing add mode paths...');
                const addMask = this.createMaskFromPathGroup(pathsByBlendMode.add, layer);
                finalMask = this.blendMasks(finalMask, addMask, 'add');
            }
            
            // 3. 处理相交模式
            if (pathsByBlendMode.intersect.length > 0) {
                console.log('Processing intersect mode paths...');
                const intersectMask = this.createMaskFromPathGroup(pathsByBlendMode.intersect, layer);
                finalMask = this.blendMasks(finalMask, intersectMask, 'intersect');
            }
            
            // 4. 处理减去模式
            if (pathsByBlendMode.subtract.length > 0) {
                console.log('Processing subtract mode paths...');
                const subtractMask = this.createMaskFromPathGroup(pathsByBlendMode.subtract, layer);
                finalMask = this.blendMasks(finalMask, subtractMask, 'subtract');
            }
            
            // 应用最终遮罩到图层
            layer.mask = finalMask;
            
            // 创建遮罩画布缓存
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = layer.width;
            maskCanvas.height = layer.height;
            const maskCtx = maskCanvas.getContext('2d');
            
            const maskImageData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
            const imgData = maskImageData.data;
            
            for (let i = 0; i < finalMask.length; i++) {
                const index = i * 4;
                const alpha = Math.round(finalMask[i] * 255);
                imgData[index] = 255;
                imgData[index + 1] = 255;
                imgData[index + 2] = 255;
                imgData[index + 3] = alpha;
            }
            
            maskCtx.putImageData(maskImageData, 0, 0);
            layer.maskCanvas = maskCanvas;
            
            console.log(`Blended mask created from ${allPaths.length} paths and applied to locked layer`);
            
            // 新增：将图像与遮罩合并为带透明度的新图像
            this.mergeImageWithMask(layer, finalMask);
            
        } catch (error) {
            console.error("钢笔工具创建混合遮罩时出错:", error);
            return;
        }
        
        // 清除临时画布
        this.clearTempCanvas();
        
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
        }).catch(error => {
            console.error('Error saving blended pen tool mask to server:', error);
        });
    }
    
    // 新增：为一组路径创建遮罩
    createMaskFromPathGroup(paths, layer) {
        // 创建临时画布
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = layer.width;
        tempCanvas.height = layer.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        // 创建变换画布
        const transformCanvas = document.createElement('canvas');
        transformCanvas.width = this.canvas.width;
        transformCanvas.height = this.canvas.height;
        const transformCtx = transformCanvas.getContext('2d', { willReadFrequently: true });
        
        // 启用抗锯齿
        transformCtx.imageSmoothingEnabled = true;
        transformCtx.imageSmoothingQuality = 'high';
        transformCtx.lineCap = 'round';
        transformCtx.lineJoin = 'round';
        
        // 绘制所有路径到变换画布
        transformCtx.save();
        transformCtx.fillStyle = '#ffffff';
        transformCtx.strokeStyle = '#ffffff';
        transformCtx.lineWidth = 1;
        
        transformCtx.beginPath();
        
        paths.forEach((path, pathIndex) => {
            const points = path.points;
            if (points.length === 0) return;
            
            // 移动到第一个点
            transformCtx.moveTo(points[0].x, points[0].y);
            
            // 绘制贝塞尔曲线路径
            for (let i = 1; i < points.length; i++) {
                const current = points[i];
                const previous = points[i - 1];
                
                if (previous.cp2 && current.cp1) {
                    transformCtx.bezierCurveTo(
                        previous.cp2.x, previous.cp2.y,
                        current.cp1.x, current.cp1.y,
                        current.x, current.y
                    );
                } else {
                    transformCtx.lineTo(current.x, current.y);
                }
            }
            
            transformCtx.closePath();
        });
        
        transformCtx.fill();
        transformCtx.restore();
        
        // 变换到图层坐标系
        tempCtx.save();
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        
        const centerX = layer.x + layer.width/2;
        const centerY = layer.y + layer.height/2;
        
        tempCtx.translate(tempCanvas.width/2, tempCanvas.height/2);
        if (layer.rotation) {
            tempCtx.rotate(-layer.rotation * Math.PI / 180);
        }
        
        const scaleX = tempCanvas.width / layer.width;
        const scaleY = tempCanvas.height / layer.height;
        tempCtx.scale(scaleX, scaleY);
        
        tempCtx.drawImage(
            transformCanvas,
            -this.canvas.width/2 + (this.canvas.width/2 - centerX),
            -this.canvas.height/2 + (this.canvas.height/2 - centerY),
            this.canvas.width,
            this.canvas.height
        );
        tempCtx.restore();
        
        // 转换为Float32Array
        const layerMaskData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const mask = new Float32Array(tempCanvas.width * tempCanvas.height).fill(0);
        const maskData = layerMaskData.data;
        
        for (let i = 0; i < Math.min(maskData.length / 4, mask.length); i++) {
            mask[i] = maskData[i * 4 + 3] / 255;
        }
        
        return mask;
    }
    
    // 新增：混合两个遮罩
    blendMasks(baseMask, overlayMask, blendMode) {
        const result = new Float32Array(baseMask.length);
        
        for (let i = 0; i < baseMask.length; i++) {
            const base = baseMask[i];
            const overlay = overlayMask[i];
            
            switch (blendMode) {
                case 'add':
                    result[i] = Math.min(1, base + overlay);
                    break;
                case 'subtract':
                    result[i] = Math.max(0, base - overlay);
                    break;
                case 'intersect':
                    result[i] = base * overlay;
                    break;
                case 'replace':
                    result[i] = overlay;
                    break;
                default:
                    result[i] = base;
            }
        }
        
        return result;
    }
    
    cancelPath() {
        // 恢复原始画布状态
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
            this.savedImageData = null;
        }
        
        if (this.currentPath) {
            this.currentPath = null;
            this.isDrawing = false;
            this.pathState = 'ready';
            this.isPreviewActive = false;
            this.drawingFromPoint = null;
            console.log('🖊️ Cancelled current path');
        }
    }
    
    // 工具配置方法
    setStrokeColor(color) {
        this.strokeColor = color;
        if (this.currentPath) {
            this.currentPath.strokeColor = color;
            this.renderPreview();
        }
    }
    
    setStrokeWidth(width) {
        this.strokeWidth = width;
        if (this.currentPath) {
            this.currentPath.strokeWidth = width;
            this.renderPreview();
        }
    }
    
    // 清理方法
    cleanup() {
        // 使用新的清除所有路径方法
        this.clearAllPaths();
        
        // 解锁图层
        this.unlockLayer();
        
        // 清理预览画布
        if (this.previewCanvas && this.previewCanvas.parentElement) {
            this.previewCanvas.parentElement.removeChild(this.previewCanvas);
        }
        
        console.log('PenTool cleaned up and layer unlocked');
    }
    
    clearPreview() {
        // 如果有保存的状态，恢复它
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
        }
    }
    
    // 新增：进入编辑模式
    enterEditMode() {
        this.editMode = true;
        this.canvas.canvas.style.cursor = 'default';
        
        // 如果正在绘制，暂停绘制状态
        if (this.pathState === 'drawing') {
            this.isPreviewActive = false;
            this.pathState = 'editing';
        }
        
        // 保存当前完整画布状态（包括所有图层）用于编辑
        if (!this.savedImageData) {
            this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // 直接重新渲染所有路径，显示编辑控制点，不触碰底层
        this.renderPathsOnly();
        
        console.log('🖊️ Pen tool entered edit mode - paths visible, layers protected');
    }
    
    // 新增：退出编辑模式
    exitEditMode() {
        this.editMode = false;
        this.canvas.canvas.style.cursor = 'crosshair';
        this.selectedPoint = null;
        this.selectedControlPoint = null;
        this.isDragging = false;
        
        // 恢复绘制状态
        if (this.pathState === 'editing') {
            if (this.currentPath && this.currentPath.points.length > 0) {
                // 如果有当前路径，设置为断开状态，等待用户点击继续
                this.pathState = 'broken';
                this.isPreviewActive = false;
                console.log('🖊️ Pen tool exited edit mode - path is ready to continue drawing');
                console.log('🖊️ Click anywhere to resume drawing from the last point');
            } else {
                // 如果没有当前路径，恢复到准备状态
                this.pathState = 'ready';
                this.isPreviewActive = false;
                console.log('🖊️ Pen tool exited edit mode - ready for new path');
            }
        }
        
        // 重新渲染，隐藏编辑控制点，不影响底层
        this.renderPathsOnly();
        
        console.log('🖊️ Pen tool exited edit mode');
    }
    
    // 新增：暂停/继续路径绘制
    togglePausePath() {
        if (this.pathState === 'drawing' && this.currentPath) {
            // 暂停绘制
            this.pausedPath = JSON.parse(JSON.stringify(this.currentPath)); // 深拷贝
            this.pathState = 'paused';
            
            // 将当前路径添加到完成路径列表中（临时）
            this.paths.push(this.currentPath);
            this.currentPath = null;
            
            // 恢复画布状态
            if (this.savedImageData) {
                this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
                this.savedImageData = null;
            }
            
            console.log('🖊️ Path paused, can continue later');
            
        } else if (this.pathState === 'paused' && this.pausedPath) {
            // 继续绘制
            this.resumePath();
            console.log('🖊️ Path resumed');
        }
        
        this.canvas.render();
    }
    
    // 新增：恢复暂停的路径
    resumePath() {
        if (this.pausedPath) {
            // 从完成路径列表中移除（因为要继续编辑）
            const index = this.paths.findIndex(p => 
                p.points.length === this.pausedPath.points.length &&
                p.points[0].x === this.pausedPath.points[0].x &&
                p.points[0].y === this.pausedPath.points[0].y
            );
            
            if (index !== -1) {
                this.paths.splice(index, 1);
            }
            
            this.currentPath = this.pausedPath;
            this.pausedPath = null;
            this.pathState = 'drawing';
            
            // 保存当前画布状态
            this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    // 新增：切换编辑模式
    toggleEditMode() {
        if (this.editMode) {
            this.exitEditMode();
        } else {
            this.enterEditMode();
        }
        this.canvas.render();
    }
    
    // 新增：获取点击的元素（锚点或控制点）
    getClickedElement(coords) {
        const hitRadius = 8; // 点击检测半径
        
        // 检查所有路径的锚点和控制点
        const allPaths = [...this.paths];
        if (this.currentPath) allPaths.push(this.currentPath);
        
        for (const path of allPaths) {
            for (const point of path.points) {
                // 检查锚点
                const distToAnchor = Math.sqrt(
                    Math.pow(coords.x - point.x, 2) + Math.pow(coords.y - point.y, 2)
                );
                
                if (distToAnchor <= hitRadius) {
                    return { point: point, controlPoint: null };
                }
                
                // 检查控制点
                if (point.cp1) {
                    const distToCp1 = Math.sqrt(
                        Math.pow(coords.x - point.cp1.x, 2) + Math.pow(coords.y - point.cp1.y, 2)
                    );
                    
                    if (distToCp1 <= hitRadius) {
                        return { point: point, controlPoint: point.cp1 };
                    }
                }
                
                if (point.cp2) {
                    const distToCp2 = Math.sqrt(
                        Math.pow(coords.x - point.cp2.x, 2) + Math.pow(coords.y - point.cp2.y, 2)
                    );
                    
                    if (distToCp2 <= hitRadius) {
                        return { point: point, controlPoint: point.cp2 };
                    }
                }
            }
        }
        
        return null;
    }
    
    // 新增：处理编辑模式的拖拽
    handleDragEdit(coords) {
        if (this.selectedControlPoint) {
            // 拖拽控制点
            this.selectedControlPoint.x = coords.x - this.dragOffset.x;
            this.selectedControlPoint.y = coords.y - this.dragOffset.y;
        } else if (this.selectedPoint) {
            // 拖拽锚点
            const deltaX = coords.x - this.dragOffset.x - this.selectedPoint.x;
            const deltaY = coords.y - this.dragOffset.y - this.selectedPoint.y;
            
            this.selectedPoint.x = coords.x - this.dragOffset.x;
            this.selectedPoint.y = coords.y - this.dragOffset.y;
            
            // 同时移动控制点
            if (this.selectedPoint.cp1) {
                this.selectedPoint.cp1.x += deltaX;
                this.selectedPoint.cp1.y += deltaY;
            }
            if (this.selectedPoint.cp2) {
                this.selectedPoint.cp2.x += deltaX;
                this.selectedPoint.cp2.y += deltaY;
            }
        }
        
        // 实时更新路径显示，不影响底层
        this.renderPathsOnly();
    }
    
    // 新增：仅渲染路径，不影响底层图像
    renderPathsOnly() {
        // 使用临时画布渲染
        this.drawToTempCanvas();
        
        // 触发Canvas重绘以显示临时画布
        this.canvas.render();
    }
    
    // 新增：绘制所有路径的方法
    drawAllPaths(ctx) {
        // 绘制所有完成的路径
        this.paths.forEach(path => {
            this.drawSmoothPath(ctx, path, null, null, this.editMode);
        });
        
        // 绘制当前路径
        if (this.currentPath) {
            this.drawSmoothPath(ctx, this.currentPath, null, null, this.editMode);
        }
    }
    
    // 新增：绘制模式下的双击处理
    handleDrawModeDoubleClick(e) {
        const coords = this.getMouseCoords(e);
        
        // 优先检查是否双击了断开路径的端点
        if (this.handleBrokenPathDoubleClick(coords)) {
            return; // 已经处理了断开路径恢复
        }
        
        const clickedElement = this.getClickedElement(coords);
        
        if (!clickedElement) {
            // 没有点击到节点，正常完成路径
            this.finishPath();
            return;
        }
        
        // 检查点击的是哪个路径的节点
        const { point, path } = this.findPointInPaths(clickedElement.point);
        if (!point || !path) return;
        
        if (path === this.currentPath && this.pathState === 'drawing') {
            // 点击当前绘制路径的节点：切换预览状态
            this.togglePreviewMode(point);
        } else {
            // 点击其他路径的节点：尝试从该点开始新绘制
            this.tryStartFromExistingPoint(point, path);
        }
    }
    
    // 新增：切换预览模式（优化版）
    togglePreviewMode(clickedPoint) {
        if (this.isPreviewActive) {
            // 当前有预览线：断开预览并自动进入编辑模式
            this.isPreviewActive = false;
            this.pathState = 'broken';
            
            // 清除预览，但保持已绘制部分
            this.clearPreviewKeepPath();
            
            // 自动进入编辑模式，方便用户调整路径
            this.enterEditMode();
            
            console.log('🖊️ Preview disconnected, auto entered edit mode');
        } else if (this.pathState === 'broken' && this.currentPath) {
            // 当前无预览线且处于断开状态：重新激活预览，退出编辑模式
            if (this.editMode) {
                this.exitEditMode();
            }
            
            this.isPreviewActive = true;
            this.pathState = 'drawing';
            
            // 重新保存画布状态用于预览
            this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            
            console.log('🖊️ Preview reconnected, continue drawing');
            this.renderPreview();
        } else {
            // 其他情况：尝试重新激活预览
            if (this.editMode) {
                this.exitEditMode();
            }
            
            if (this.currentPath) {
                this.isPreviewActive = true;
                this.pathState = 'drawing';
                
                // 重新保存画布状态用于预览
                this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                
                console.log('🖊️ Preview reconnected, continue drawing');
                this.renderPreview();
            }
        }
    }
    
    // 新增：尝试从已存在的点开始绘制（优化版）
    tryStartFromExistingPoint(point, path) {
        const pointIndex = path.points.indexOf(point);
        
        // 检查该点是否为可用的起始点（单端点）
        if (!this.isValidStartPoint(point, path, pointIndex)) {
            console.log('🖊️ Cannot start from this point - it has connections on both sides');
            return;
        }
        
        // 如果在编辑模式下双击端点，退出编辑模式并开始绘制
        if (this.editMode) {
            this.exitEditMode();
        }
        
        // 完成当前路径（如果有）
        if (this.currentPath) {
            this.finishCurrentPath();
        }
        
        // 从该点开始新路径
        this.startNewPathFromExistingPoint(point, path, pointIndex);
        
        console.log('🖊️ Started new drawing from existing point');
    }
    
    // 新增：检查点是否为有效起始点
    isValidStartPoint(point, path, pointIndex) {
        // 端点（首或尾）总是有效的
        if (pointIndex === 0 || pointIndex === path.points.length - 1) {
            return true;
        }
        
        // 中间点不能作为起始点（两端都有连线）
        return false;
    }
    
    // 新增：从现有点开始新路径
    startNewPathFromExistingPoint(point, path, pointIndex) {
        // 创建新路径，起始点为选中的点
        this.currentPath = {
            points: [{
                x: point.x,
                y: point.y,
                type: 'anchor',
                cp1: point.cp1 ? { ...point.cp1 } : null,
                cp2: point.cp2 ? { ...point.cp2 } : null
            }],
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            closed: false,
            sourcePoint: point, // 记录源点，用于后续连接
            sourcePath: path
        };
        
        this.pathState = 'drawing';
        this.isPreviewActive = true;
        this.drawingFromPoint = point;
        
        // 保存画布状态用于预览
        this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        this.renderPreview();
    }
    
    // 新增：完成当前路径但不应用遮罩
    finishCurrentPath() {
        if (this.currentPath && this.currentPath.points.length > 1) {
            // 将当前路径添加到完成路径列表
            this.paths.push({ ...this.currentPath });
            console.log('🖊️ Current path added to completed paths');
        }
        
        // 重置状态
        this.currentPath = null;
        this.isPreviewActive = false;
        this.pathState = 'ready';
        this.drawingFromPoint = null;
        
        // 清除预览状态
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
            this.savedImageData = null;
        }
    }
    
    // 新增：清除预览但保持路径（保护底层版本）
    clearPreviewKeepPath() {
        // 重新绘制所有路径到临时画布
        this.drawToTempCanvas();
        
        // 触发Canvas重绘
        this.canvas.render();
    }
    
    // 新增：在路径中查找点
    findPointInPaths(targetPoint) {
        // 先检查当前路径
        if (this.currentPath) {
            for (const point of this.currentPath.points) {
                if (point === targetPoint) {
                    return { point: point, path: this.currentPath };
                }
            }
        }
        
        // 检查所有完成的路径
        for (const path of this.paths) {
            for (const point of path.points) {
                if (point === targetPoint) {
                    return { point: point, path: path };
                }
            }
        }
        
        return { point: null, path: null };
    }
    
    // 新增：保留编辑模式的双击功能（用于编辑控制点等）
    handleEditModeDoubleClick(e) {
        const coords = this.getMouseCoords(e);
        const clickedElement = this.getClickedElement(coords);
        
        if (!clickedElement) return;
        
        // Canvas事件已被禁用，不需要阻止冒泡
        
        // 编辑模式下的双击主要用于精确编辑
        console.log('🖊️ Edit mode double click - advanced editing features can be added here');
        
        // 示例：双击锚点重置其控制点
        if (!clickedElement.controlPoint && clickedElement.point.cp1) {
            const point = clickedElement.point;
            this.createControlPointsForAnchor(point);
            this.renderPathsOnly(); // 使用保护底层的渲染方法
            console.log('🖊️ Control points reset for anchor');
        }
    }
    
    // 新增：更新画布大小
    updateCanvasSize(width, height) {
        // 如果尺寸没有变化，不需要重新创建
        if (this.tempCanvas.width === width && this.tempCanvas.height === height) {
            return;
        }
        
        // 设置临时画布大小
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;
    }
    
    // 新增：获取临时画布（供Canvas渲染使用）
    getTempCanvas() {
        return this.isActive ? this.tempCanvas : null;
    }
    
    // 新增：绘制平滑路径方法
    drawSmoothPath(ctx, path, previewX = null, previewY = null, showEditHandles = false) {
        if (!path || path.points.length === 0) return;
        
        ctx.save();
        
        // 设置路径样式
        ctx.strokeStyle = path.strokeColor || '#ff0000';
        ctx.lineWidth = Math.max(path.strokeWidth || 2, 2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        
        ctx.beginPath();
        
        const points = path.points;
        
        if (points.length === 1) {
            // 只有一个点，绘制到预览位置
            ctx.moveTo(points[0].x, points[0].y);
            if (previewX !== null && previewY !== null) {
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = '#00ff00';
                ctx.lineTo(previewX, previewY);
            }
        } else {
            // 多个点，绘制平滑曲线
            ctx.moveTo(points[0].x, points[0].y);
            
            for (let i = 1; i < points.length; i++) {
                const current = points[i];
                const previous = points[i - 1];
                
                if (previous.cp2 && current.cp1) {
                    // 使用贝塞尔曲线
                    ctx.bezierCurveTo(
                        previous.cp2.x, previous.cp2.y,
                        current.cp1.x, current.cp1.y,
                        current.x, current.y
                    );
                } else {
                    // 直线连接
                    ctx.lineTo(current.x, current.y);
                }
            }
            
            // 预览线到鼠标位置
            if (previewX !== null && previewY !== null && points.length > 0) {
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 1;
                const lastPoint = points[points.length - 1];
                ctx.moveTo(lastPoint.x, lastPoint.y);
                ctx.lineTo(previewX, previewY);
            }
        }
        
        ctx.stroke();
        ctx.restore();
        
        // 绘制控制点
        this.drawControlPoints(ctx, path, previewX, previewY, showEditHandles);
    }
    
    // 新增：绘制控制点方法
    drawControlPoints(ctx, path, previewX = null, previewY = null, showEditHandles = false) {
        ctx.save();
        
        path.points.forEach((point, index) => {
            // 绘制锚点
            ctx.fillStyle = path.strokeColor || '#ff0000';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, showEditHandles ? 6 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // 在编辑模式或有控制点时绘制控制点
            if ((showEditHandles || this.editMode || this.isDragCreating) && (point.cp1 || point.cp2)) {
                
                // 绘制控制点1
                if (point.cp1) {
                    // 控制线
                    ctx.strokeStyle = '#00ff00';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(point.x, point.y);
                    ctx.lineTo(point.cp1.x, point.cp1.y);
                    ctx.stroke();
                    
                    // 控制点
                    ctx.fillStyle = '#00ff00';
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(point.cp1.x, point.cp1.y, showEditHandles ? 4 : 2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
                
                // 绘制控制点2
                if (point.cp2) {
                    // 控制线
                    ctx.strokeStyle = '#0080ff';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(point.x, point.y);
                    ctx.lineTo(point.cp2.x, point.cp2.y);
                    ctx.stroke();
                    
                    // 控制点
                    ctx.fillStyle = '#0080ff';
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(point.cp2.x, point.cp2.y, showEditHandles ? 4 : 2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
            
            // 高亮选中的点
            if (this.editMode && this.selectedPoint === point) {
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 3;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // 高亮选中的控制点
            if (this.editMode && this.selectedControlPoint) {
                if (this.selectedControlPoint === point.cp1) {
                    ctx.strokeStyle = '#ffff00';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(point.cp1.x, point.cp1.y, 6, 0, Math.PI * 2);
                    ctx.stroke();
                }
                
                if (this.selectedControlPoint === point.cp2) {
                    ctx.strokeStyle = '#ffff00';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(point.cp2.x, point.cp2.y, 6, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        });
        
        // 绘制拖动创建过程中的临时控制点
        if (this.isDragCreating && this.tempControlPoint && this.currentDragPoint) {
            const dragPoint = this.currentDragPoint;
            
            // 绘制临时控制线
            ctx.strokeStyle = '#ff00ff'; // 紫红色表示正在拖动
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(dragPoint.x, dragPoint.y);
            ctx.lineTo(this.tempControlPoint.x, this.tempControlPoint.y);
            ctx.stroke();
            
            // 绘制对称的控制线
            const dx = this.tempControlPoint.x - dragPoint.x;
            const dy = this.tempControlPoint.y - dragPoint.y;
            ctx.beginPath();
            ctx.moveTo(dragPoint.x, dragPoint.y);
            ctx.lineTo(dragPoint.x - dx, dragPoint.y - dy);
            ctx.stroke();
            
            // 绘制临时控制点
            ctx.fillStyle = '#ff00ff';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(this.tempControlPoint.x, this.tempControlPoint.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // 绘制对称控制点
            ctx.beginPath();
            ctx.arc(dragPoint.x - dx, dragPoint.y - dy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        
        // 绘制预览点
        if (previewX !== null && previewY !== null) {
            ctx.fillStyle = '#ffff00';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(previewX, previewY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    handleEditModeClick(coords, e) {
        // 在编辑模式下，检测路径元素
        const clickedElement = this.getClickedElement(coords);
        
        if (clickedElement) {
            // 找到路径元素，处理选择和拖拽
            this.selectedPoint = clickedElement.point;
            this.selectedControlPoint = clickedElement.controlPoint;
            this.isDragging = true;
            
            // 计算拖拽偏移
            if (clickedElement.controlPoint) {
                this.dragOffset.x = coords.x - clickedElement.controlPoint.x;
                this.dragOffset.y = coords.y - clickedElement.controlPoint.y;
            } else {
                this.dragOffset.x = coords.x - clickedElement.point.x;
                this.dragOffset.y = coords.y - clickedElement.point.y;
            }
            
            // Canvas事件已被禁用，不需要阻止冒泡
            
            console.log('🖊️ Selected path element for editing:', clickedElement);
        }
        // 如果没有点击到路径元素，什么都不做（Canvas事件已禁用）
    }
    
    // === 多路径管理系统 ===
    
    // 断开当前路径（通过UI按钮调用）
    breakCurrentPath() {
        if (!this.currentPath || this.currentPath.points.length === 0) {
            console.log('🖊️ No current path to break');
            return;
        }
        
        // 创建断开路径对象
        const brokenPath = {
            ...this.currentPath,
            id: ++this.pathCounter,
            blendMode: this.currentBlendMode,
            state: 'broken',
            name: `路径${this.pathCounter}`,
            lastPoint: this.currentPath.points[this.currentPath.points.length - 1]
        };
        
        this.brokenPaths.push(brokenPath);
        
        // 重置当前路径状态
        this.currentPath = null;
        this.pathState = 'ready';
        this.isPreviewActive = false;
        this.activePath = null;
        
        // 清除预览状态
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
            this.savedImageData = null;
        }
        
        // 重新渲染
        this.renderPathsOnly();
        
        console.log(`🖊️ Path broken: ${brokenPath.name} (${brokenPath.blendMode} mode)`);
        console.log(`🖊️ Total broken paths: ${this.brokenPaths.length}`);
        
        // 触发UI更新回调
        this.onPathStatusChange?.();
    }
    
    // 设置遮罩合成模式
    setBlendMode(mode) {
        const validModes = ['add', 'subtract', 'intersect', 'replace'];
        if (!validModes.includes(mode)) {
            console.warn(`Invalid blend mode: ${mode}`);
            return;
        }
        
        this.currentBlendMode = mode;
        
        // 如果有当前路径，更新其混合模式
        if (this.currentPath) {
            this.currentPath.blendMode = mode;
        }
        
        console.log(`🖊️ Blend mode set to: ${mode}`);
        this.onPathStatusChange?.();
    }
    
    // 从断开路径的端点恢复绘制
    resumeFromBrokenPathEndpoint(pathId, pointIndex) {
        const pathIndex = this.brokenPaths.findIndex(p => p.id === pathId);
        if (pathIndex === -1) {
            console.warn(`Broken path not found: ${pathId}`);
            return false;
        }
        
        const brokenPath = this.brokenPaths[pathIndex];
        
        // 检查是否是端点
        if (pointIndex !== 0 && pointIndex !== brokenPath.points.length - 1) {
            console.warn('Can only resume from endpoint');
            return false;
        }
        
        // 如果当前有活动路径，先断开它
        if (this.currentPath && this.currentPath.points.length > 0) {
            this.breakCurrentPath();
        }
        
        // 恢复断开的路径为当前路径
        this.currentPath = { ...brokenPath };
        delete this.currentPath.id;
        delete this.currentPath.state;
        delete this.currentPath.name;
        delete this.currentPath.lastPoint;
        
        // 设置混合模式为路径的模式
        this.currentBlendMode = brokenPath.blendMode;
        
        // 从断开路径列表中移除
        this.brokenPaths.splice(pathIndex, 1);
        
        // 设置为绘制状态
        this.pathState = 'drawing';
        this.isPreviewActive = true;
        this.activePath = this.currentPath;
        
        // 保存画布状态用于预览
        this.savedImageData = this.canvas.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        console.log(`🖊️ Resumed from broken path endpoint (${this.currentBlendMode} mode)`);
        console.log(`🖊️ Remaining broken paths: ${this.brokenPaths.length}`);
        
        this.onPathStatusChange?.();
        this.renderPreview();
        
        return true;
    }
    
    // 清除所有路径并恢复初始状态
    clearAllPaths() {
        // 清除所有路径数据
        this.currentPath = null;
        this.brokenPaths = [];
        this.paths = [];
        this.pathCounter = 0;
        this.activePath = null;
        
        // 重置状态
        this.pathState = 'ready';
        this.isPreviewActive = false;
        this.editMode = false;
        this.selectedPoint = null;
        this.selectedControlPoint = null;
        this.isDragging = false;
        
        // 清除预览状态
        if (this.savedImageData) {
            this.canvas.ctx.putImageData(this.savedImageData, 0, 0);
            this.savedImageData = null;
        }
        
        // 清除临时画布
        this.clearTempCanvas();
        
        // 重新渲染画布
        this.canvas.render();
        
        console.log('🖊️ All paths cleared - reset to initial activated state');
        console.log('🔒 Layer remains locked for pen tool');
        
        // 触发UI更新
        this.onPathStatusChange?.();
    }
    
    // 获取路径状态信息
    getPathStatus() {
        const currentPathInfo = this.currentPath ? {
            points: this.currentPath.points.length,
            blendMode: this.currentPath.blendMode || this.currentBlendMode,
            state: this.pathState
        } : null;
        
        const brokenPathsInfo = this.brokenPaths.map(path => ({
            id: path.id,
            name: path.name,
            points: path.points.length,
            blendMode: path.blendMode
        }));
        
        return {
            currentPath: currentPathInfo,
            brokenPaths: brokenPathsInfo,
            totalPaths: this.paths.length,
            pathCounter: this.pathCounter,
            currentBlendMode: this.currentBlendMode
        };
    }
    
    // 设置路径状态变化回调
    setPathStatusChangeCallback(callback) {
        this.onPathStatusChange = callback;
    }
    
    // 检测双击的断开路径端点
    handleBrokenPathDoubleClick(coords) {
        for (const brokenPath of this.brokenPaths) {
            const points = brokenPath.points;
            
            // 检查首端点
            if (this.isPointClicked(coords, points[0])) {
                this.resumeFromBrokenPathEndpoint(brokenPath.id, 0);
                return true;
            }
            
            // 检查尾端点
            if (this.isPointClicked(coords, points[points.length - 1])) {
                this.resumeFromBrokenPathEndpoint(brokenPath.id, points.length - 1);
                return true;
            }
        }
        
        return false;
    }
    
    // 检测点击是否命中指定点
    isPointClicked(coords, point, radius = 8) {
        const distance = Math.sqrt(
            Math.pow(coords.x - point.x, 2) + Math.pow(coords.y - point.y, 2)
        );
        return distance <= radius;
    }
    
    // 新增：处理删除节点（D键）
    handleDeleteNode() {
        if (this.editMode) {
            // 编辑模式：删除选中的节点
            this.deleteSelectedNode();
        } else {
            // 绘制模式：回退最后一个节点
            this.undoLastNode();
        }
    }
    
    // 新增：绘制模式下回退最后一个节点
    undoLastNode() {
        if (!this.currentPath || this.currentPath.points.length === 0) {
            console.log('🖊️ No nodes to undo');
            return;
        }
        
        if (this.currentPath.points.length === 1) {
            // 如果只有一个点，取消整个路径
            console.log('🖊️ Undoing last node - cancelling path');
            this.cancelPath();
            return;
        }
        
        // 删除最后一个点
        this.currentPath.points.pop();
        console.log(`🖊️ Undid last node - ${this.currentPath.points.length} nodes remaining`);
        
        // 重新渲染预览
        this.renderPreview();
    }
    
    // 新增：编辑模式下删除选中的节点
    deleteSelectedNode() {
        if (!this.selectedPoint) {
            console.log('🖊️ No node selected for deletion');
            return;
        }
        
        // 查找选中点所在的路径
        const { point, path } = this.findPointInPaths(this.selectedPoint);
        if (!point || !path) {
            console.log('🖊️ Selected point not found in any path');
            return;
        }
        
        const pointIndex = path.points.indexOf(point);
        if (pointIndex === -1) {
            console.log('🖊️ Point index not found');
            return;
        }
        
        // 检查路径最小点数限制
        if (path.points.length <= 2) {
            console.log('🖊️ Cannot delete node - path needs at least 2 points');
            // 如果是当前路径且只有1-2个点，可以删除整个路径
            if (path === this.currentPath) {
                console.log('🖊️ Deleting entire current path');
                this.cancelPath();
            }
            return;
        }
        
        // 删除节点
        path.points.splice(pointIndex, 1);
        console.log(`🖊️ Deleted node at index ${pointIndex} - ${path.points.length} nodes remaining`);
        
        // 清除选择状态
        this.selectedPoint = null;
        this.selectedControlPoint = null;
        
        // 重新渲染
        this.renderPathsOnly();
    }
    
    // 新增：将图层图像与遮罩合并为带透明度的新图像
    mergeImageWithMask(layer, mask) {
        if (!layer.image || !mask) {
            console.log('🖊️ No image or mask to merge');
            return;
        }
        
        console.log('🖊️ Merging image with mask to create new RGBA image...');
        
        // 创建临时画布来处理图像合并
        const mergeCanvas = document.createElement('canvas');
        mergeCanvas.width = layer.width;
        mergeCanvas.height = layer.height;
        const mergeCtx = mergeCanvas.getContext('2d');
        
        // 绘制原始图像
        mergeCtx.drawImage(layer.image, 0, 0, layer.width, layer.height);
        
        // 获取图像数据
        const imageData = mergeCtx.getImageData(0, 0, layer.width, layer.height);
        const pixels = imageData.data;
        
        // 应用遮罩到alpha通道
        for (let i = 0; i < mask.length; i++) {
            const pixelIndex = i * 4;
            const maskAlpha = mask[i]; // 0-1
            
            // 将遮罩值应用到图像的alpha通道
            // 保持原始RGB值，只修改Alpha
            pixels[pixelIndex + 3] = Math.round(pixels[pixelIndex + 3] * maskAlpha);
        }
        
        // 将修改后的数据放回画布
        mergeCtx.putImageData(imageData, 0, 0);
        
        // 创建新的图像对象
        const newImage = new Image();
        newImage.onload = () => {
            // 替换图层的图像
            layer.image = newImage;
            
            // 清除遮罩，因为已经合并到图像中
            layer.mask = null;
            layer.maskCanvas = null;
            
            console.log('🖊️ Image and mask merged successfully - new RGBA image created');
            
            // 重新渲染画布
            this.canvas.render();
            
            // 保存到服务器
            this.canvas.saveToServer(this.canvas.widget.value).then(() => {
                if (this.canvas.node) {
                    this.canvas.node.setDirtyCanvas(true);
                    if (typeof app !== 'undefined') {
                        app.graph.runStep();
                    }
                }
                console.log('🖊️ Merged image saved to server');
            }).catch(error => {
                console.error('Error saving merged image to server:', error);
            });
        };
        
        newImage.src = mergeCanvas.toDataURL('image/png');
    }
} 