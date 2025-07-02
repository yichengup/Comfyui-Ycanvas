import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { Canvas } from "./Canvas.js";
import { LassoTool } from "./LassoTool.js";
import { CanvasBlendMode } from "./CanvasBlendMode.js";
import { PenTool } from "./PenTool.js";

async function createCanvasWidget(node, widget, app) {
    const canvas = new Canvas(node, widget);
    
    // 初始化钢笔工具
    const penTool = new PenTool(canvas);
    canvas.penTool = penTool;

    // 添加全局样式
    const style = document.createElement('style');
    style.textContent = `
        .painter-button {
            background: linear-gradient(to bottom, #4a4a4a, #3a3a3a);
            border: 1px solid #2a2a2a;
            border-radius: 4px;
            color: #ffffff;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            min-width: 80px;
            text-align: center;
            margin: 2px;
            text-shadow: 0 1px 1px rgba(0,0,0,0.2);
        }

        .painter-button:hover {
            background: linear-gradient(to bottom, #5a5a5a, #4a4a4a);
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }

        .painter-button:active {
            background: linear-gradient(to bottom, #3a3a3a, #4a4a4a);
            transform: translateY(1px);
        }

        .painter-button.primary {
            background: linear-gradient(to bottom, #4a6cd4, #3a5cc4);
            border-color: #2a4cb4;
        }

        .painter-button.primary:hover {
            background: linear-gradient(to bottom, #5a7ce4, #4a6cd4);
        }

        .painter-controls {
            background: linear-gradient(to bottom, #404040, #383838);
            border-bottom: 1px solid #2a2a2a;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 8px;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            align-items: center;
        }

        .painter-container {
            background: #607080;  /* 带蓝色的灰色背景 */
            border: 1px solid #4a5a6a;
            border-radius: 6px;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.1);
        }

        .painter-dialog {
            background: #404040;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            padding: 20px;
            color: #ffffff;
        }

        .painter-dialog input {
            background: #303030;
            border: 1px solid #505050;
            border-radius: 4px;
            color: #ffffff;
            padding: 4px 8px;
            margin: 4px;
            width: 80px;
        }

        .painter-dialog button {
            background: #505050;
            border: 1px solid #606060;
            border-radius: 4px;
            color: #ffffff;
            padding: 4px 12px;
            margin: 4px;
            cursor: pointer;
        }

        .painter-dialog button:hover {
            background: #606060;
        }

        .blend-opacity-slider {
            width: 100%;
            margin: 5px 0;
            display: none;
        }
        
        .blend-mode-active .blend-opacity-slider {
            display: block;
        }
        
        .blend-mode-item {
            padding: 5px;
            cursor: pointer;
            position: relative;
        }
        
        .blend-mode-item.active {
            background-color: rgba(0,0,0,0.1);
        }
        
        .painter-button.active {
            background: #5a5a5a !important;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
        }
        
        .lasso-mode-select {
            min-width: 80px;
            font-size: 12px;
        }
        
        .lasso-mode-select option {
            background: #3a3a3a;
            color: white;
        }
        
        /* 等比例缩放开关样式 */
        #proportional-scale-toggle {
            position: relative;
            transition: all 0.3s ease;
        }
        
        #proportional-scale-toggle.active {
            background: linear-gradient(to bottom, #4a8c4a, #3a7c3a) !important;
            border-color: #2a6c2a !important;
            color: #ffffff !important;
            box-shadow: 0 0 8px rgba(74, 140, 74, 0.3);
        }
        
        #proportional-scale-toggle:hover::after {
            content: "开启后拖拽控制框将等比例缩放";
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: #2a2a2a;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            white-space: nowrap;
            z-index: 1000;
            margin-bottom: 5px;
        }
    `;
    document.head.appendChild(style);

    // 修改控制面板，使其高度自适应
    const controlPanel = $el("div.painterControlPanel", {}, [
        $el("div.controls.painter-controls", {
            style: {
                position: "absolute",
                top: "0",
                left: "0",
                right: "0",
                minHeight: "50px",
                zIndex: "10",
                background: "linear-gradient(to bottom, #404040, #383838)",
                borderBottom: "1px solid #2a2a2a",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                padding: "8px",
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                alignItems: "center"
            },
            onresize: (entries) => {
                const controlsHeight = entries[0].target.offsetHeight;
                canvasContainer.style.top = (controlsHeight + 10) + "px";
            }
        }, [
            $el("button.painter-button.primary", {
                textContent: "Add Image",
                onclick: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.multiple = true;
                    input.onchange = async (e) => {
                        for (const file of e.target.files) {
                            // 创建图片对象
                            const img = new Image();
                            img.onload = async () => {
                                // 计算适当的缩放比例
                                const scale = Math.min(
                                    canvas.width / img.width * 0.8,
                                    canvas.height / img.height * 0.8
                                );
                                
                                // 创建新图层
                                const layer = {
                                    image: img,
                                    x: (canvas.width - img.width * scale) / 2,
                                    y: (canvas.height - img.height * scale) / 2,
                                    width: img.width * scale,
                                    height: img.height * scale,
                                    rotation: 0,
                                    zIndex: canvas.layers.length
                                };
                                
                                // 添加图层并选中
                                canvas.layers.push(layer);
                                canvas.selectedLayer = layer;
                                
                                // 渲染画布
                                canvas.render();
                                
                                // 立即保存并触发输出更新
                                await canvas.saveToServer(widget.value);
                                
                                // 触发节点更新
                                app.graph.runStep();
                            };
                            img.src = URL.createObjectURL(file);
                        }
                    };
                    input.click();
                }
            }),
            $el("button.painter-button.primary", {
                textContent: "Import Input",
                onclick: async () => {
                    try {
                        console.log("Import Input clicked");
                        console.log("Node ID:", node.id);
                        
                        const response = await fetch(`/ycnode/get_canvas_data/${node.id}`);
                        console.log("Response status:", response.status);
                        
                        const result = await response.json();
                        console.log("Full response data:", result);
                        
                        if (result.success && result.data) {
                            if (result.data.image) {
                                console.log("Found image data, importing...");
                                await canvas.importImage(result.data);
                                await canvas.saveToServer(widget.value);
                                app.graph.runStep();
                            } else {
                                throw new Error("No image data found in cache");
                            }
                        } else {
                            throw new Error("Invalid response format");
                        }
                        
                    } catch (error) {
                        console.error("Error importing input:", error);
                        alert(`Failed to import input: ${error.message}`);
                    }
                }
            }),
            $el("button.painter-button", {
                textContent: "Canvas Size",
                onclick: () => {
                    const dialog = $el("div.painter-dialog", {
                        style: {
                            position: 'fixed',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            zIndex: '1000'
                        }
                    }, [
                        $el("div", {
                            style: {
                                color: "white",
                                marginBottom: "10px"
                            }
                        }, [
                            $el("label", {
                                style: {
                                    marginRight: "5px"
                                }
                            }, [
                                $el("span", {}, ["Width: "])
                            ]),
                            $el("input", {
                                type: "number",
                                id: "canvas-width",
                                value: canvas.width,
                                min: "1",
                                max: "4096"
                            })
                        ]),
                        $el("div", {
                            style: {
                                color: "white",
                                marginBottom: "10px"
                            }
                        }, [
                            $el("label", {
                                style: {
                                    marginRight: "5px"
                                }
                            }, [
                                $el("span", {}, ["Height: "])
                            ]),
                            $el("input", {
                                type: "number",
                                id: "canvas-height",
                                value: canvas.height,
                                min: "1",
                                max: "4096"
                            })
                        ]),
                        $el("div", {
                            style: {
                                textAlign: "right"
                            }
                        }, [
                            $el("button", {
                                id: "cancel-size",
                                textContent: "Cancel"
                            }),
                            $el("button", {
                                id: "confirm-size",
                                textContent: "OK"
                            })
                        ])
                    ]);
                    document.body.appendChild(dialog);

                    document.getElementById('confirm-size').onclick = () => {
                        const width = parseInt(document.getElementById('canvas-width').value) || canvas.width;
                        const height = parseInt(document.getElementById('canvas-height').value) || canvas.height;
                        canvas.updateCanvasSize(width, height);
                        document.body.removeChild(dialog);
                    };

                    document.getElementById('cancel-size').onclick = () => {
                        document.body.removeChild(dialog);
                    };
                }
            }),
            $el("button.painter-button", {
                textContent: "Remove Layer",
                onclick: () => {
                    const index = canvas.layers.indexOf(canvas.selectedLayer);
                    canvas.removeLayer(index);
                }
            }),
            $el("button.painter-button", {
                textContent: "Rotate +90°",
                onclick: () => canvas.rotateLayer(90)
            }),
            $el("button.painter-button", {
                textContent: "Scale +5%",
                onclick: () => canvas.resizeLayer(1.05)
            }),
            $el("button.painter-button", {
                textContent: "Scale -5%",
                onclick: () => canvas.resizeLayer(0.95)
            }),
            // 添加等比例缩放开关
            $el("button.painter-button", {
                textContent: "等比例",
                id: "proportional-scale-toggle",
                onclick: function() {
                    const isEnabled = canvas.toggleProportionalScaling();
                    this.textContent = "等比例";
                    this.classList.toggle('active', isEnabled);
                    
                    // 添加视觉反馈
                    if (isEnabled) {
                        this.style.background = 'linear-gradient(to bottom, #4a8c4a, #3a7c3a)';
                        this.style.borderColor = '#2a6c2a';
                    } else {
                        this.style.background = '';
                        this.style.borderColor = '';
                    }
                }
            }),
            $el("button.painter-button", {
                textContent: "Layer Up",
                onclick: async () => {
                    canvas.moveLayerUp();
                    await canvas.saveToServer(widget.value);
                    app.graph.runStep();
                }
            }),
            $el("button.painter-button", {
                textContent: "Layer Down",
                onclick: async () => {
                    canvas.moveLayerDown();
                    await canvas.saveToServer(widget.value);
                    app.graph.runStep();
                }
            }),
            // 添加水平镜像按钮
            $el("button.painter-button", {
                textContent: "Mirror H",
                onclick: () => {
                    canvas.mirrorHorizontal();
                }
            }),
            // 添加垂直镜像按钮
            $el("button.painter-button", {
                textContent: "Mirror V",
                onclick: () => {
                    canvas.mirrorVertical();
                }
            }),
            // 新增：复制图层按钮
            $el("button.painter-button", {
                textContent: "Copy Layer",
                style: {
                    background: "linear-gradient(to bottom, #4a6c4a, #3a5c3a)",
                    borderColor: "#2a4c2a"
                },
                onclick: async () => {
                    try {
                        if (!canvas.selectedLayer) {
                            alert("请先选择一个图层再进行复制");
                            return;
                        }
                        
                        console.log("Duplicating selected layer...");
                        const duplicatedLayer = canvas.duplicateSelectedLayer();
                        
                        if (duplicatedLayer) {
                            // 保存并更新
                            await canvas.saveToServer(widget.value);
                            app.graph.runStep();
                            
                            console.log("Layer duplicated and saved successfully");
                        } else {
                            throw new Error("Failed to duplicate layer");
                        }
                        
                    } catch (error) {
                        console.error("Copy layer error:", error);
                        alert(`复制图层失败: ${error.message}`);
                    }
                }
            }),
            // 新增：清除缓存按钮
            $el("button.painter-button", {
                textContent: "Clear Cache",
                style: {
                    background: "linear-gradient(to bottom, #c44a4a, #b43a3a)",
                    borderColor: "#a42a2a",
                    color: "#ffffff"
                },
                onclick: async () => {
                    try {
                        console.log("Clearing all cache data...");
                        canvas.clearAllCache();
                        
                        // 保存空画布状态并更新
                        await canvas.saveToServer(widget.value);
                        app.graph.runStep();
                        
                        console.log("Cache cleared and saved successfully");
                        
                    } catch (error) {
                        console.error("Clear cache error:", error);
                        alert(`清除缓存失败: ${error.message}`);
                    }
                }
            }),
            // 在控制面板中添加抠图按钮
            $el("button.painter-button", {
                textContent: "Matting",
                onclick: async () => {
                    try {
                        if (!canvas.selectedLayer) {
                            throw new Error("Please select an image first");
                        }
                        
                        // 获取或创建状态指示器
                        const statusIndicator = MattingStatusIndicator.getInstance(controlPanel.querySelector('.controls'));
                        
                        // 添加状态监听
                        const updateStatus = (event) => {
                            const {status} = event.detail;
                            statusIndicator.setStatus(status);
                        };
                        
                        api.addEventListener("matting_status", updateStatus);
                        
                        try {
                            // 获取图像据
                            const imageData = await canvas.getLayerImageData(canvas.selectedLayer);
                            console.log("Sending image to server...");
                            
                            // 发送请求
                            const response = await fetch("/matting", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    image: imageData,
                                    threshold: 0.5,
                                    refinement: 1
                                })
                            });
                            
                            if (!response.ok) {
                                throw new Error(`Server error: ${response.status}`);
                            }
                            
                            const result = await response.json();
                            console.log("Creating new layer with matting result...");
                            
                            // 创建新图层
                            const mattedImage = new Image();
                            mattedImage.onload = async () => {
                                // 创建临时画布来处理透明度
                                const tempCanvas = document.createElement('canvas');
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCanvas.width = canvas.selectedLayer.width;
                                tempCanvas.height = canvas.selectedLayer.height;
                                
                                // 绘制原始图像
                                tempCtx.drawImage(
                                    mattedImage,
                                    0, 0,
                                    tempCanvas.width, tempCanvas.height
                                );
                                
                                // 创建新图层
                                const newImage = new Image();
                                newImage.onload = async () => {
                                    const newLayer = {
                                        image: newImage,
                                        x: canvas.selectedLayer.x,
                                        y: canvas.selectedLayer.y,
                                        width: canvas.selectedLayer.width,
                                        height: canvas.selectedLayer.height,
                                        rotation: canvas.selectedLayer.rotation,
                                        zIndex: canvas.layers.length + 1
                                    };
                                    
                                    canvas.layers.push(newLayer);
                                    canvas.selectedLayer = newLayer;
                                    canvas.render();
                                    
                                    // 保存并更新
                                    await canvas.saveToServer(widget.value);
                                    app.graph.runStep();
                                    
                                    // 显示抠图完成提示
                                    alert("抠图完成！新图层已创建");
                                };
                                
                                // 转换为PNG并保持透明度
                                newImage.src = tempCanvas.toDataURL('image/png');
                            };
                            
                            mattedImage.src = result.matted_image;
                            console.log("Matting result applied successfully");
                            
                        } finally {
                            api.removeEventListener("matting_status", updateStatus);
                        }
                        
                    } catch (error) {
                        console.error("Matting error:", error);
                        alert(`Error during matting process: ${error.message}`);
                    }
                }
            }),
            // 添加套索工具按钮组
            $el("div.lasso-tools", {
                style: {
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    padding: "0 8px",
                    borderLeft: "1px solid #505050"
                }
            }, [
                // 套索工具按钮
                $el("button.painter-button", {
                    textContent: "套索工具",
                    style: {
                        background: "#3a3a3a"
                    },
                    onclick: async () => {
                        const button = event.target;
                        
                        // 检查是否有选中的有效图层
                        if (!canvas.selectedLayer || !canvas.selectedLayer.image) {
                            alert("请先选择一个图层再使用套索工具");
                            return;
                        }
                        
                        const isActive = button.classList.toggle('active');
                        button.style.background = isActive ? '#5a5a5a' : '#3a3a3a';
                        
                        // 使用 toggle 方法激活套索工具
                        if (canvas.lassoTool) {
                            const result = canvas.lassoTool.toggle(isActive);
                            // 显示/隐藏模式选择器
                            const modeSelect = button.parentElement.querySelector('.lasso-mode-select');
                            if (modeSelect) {
                                modeSelect.style.display = result ? 'block' : 'none';
                            }
                            
                            // 使用toggle方法时的遮罩自动合并和保存已经在LassoTool内部处理了
                            // 不需要额外的处理逻辑
                        }
                    }
                }),
                
                // 套索模式选择器
                $el("select.lasso-mode-select.painter-button", {
                    style: {
                        display: "none",
                        padding: "4px",
                        background: "#3a3a3a",
                        border: "1px solid #4a4a4a",
                        color: "white",
                        borderRadius: "3px",
                        cursor: "pointer"
                    },
                    onchange: (e) => {
                        if (canvas.lassoTool) {
                            canvas.lassoTool.setMode(e.target.value);
                        }
                    }
                }, [
                    $el("option", { value: "new", textContent: "新建" }),
                    $el("option", { value: "add", textContent: "添加" }),
                    $el("option", { value: "subtract", textContent: "减去" }),
                    $el("option", { value: "restore", textContent: "恢复原图" })
                ]),
                
                // 钢笔工具按钮（移动到套索工具组内部）
                $el("button.painter-button", {
                    textContent: "钢笔工具",
                    style: {
                        background: "#3a3a3a",
                        marginLeft: "8px" // 与套索工具保持一定间距
                    },
                    onclick: async () => {
                        const button = event.target;
                        const isActive = button.classList.toggle('active');
                        button.style.background = isActive ? '#5a5a5a' : '#3a3a3a';
                        
                        // 停用其他工具
                        if (isActive) {
                            // 停用套索工具
                            const lassoButton = button.parentElement.querySelector('button.painter-button');
                            if (lassoButton && lassoButton !== button && lassoButton.classList.contains('active')) {
                                lassoButton.click();
                            }
                            
                            // 激活钢笔工具
                            canvas.penTool.activate();
                            
                            // 显示钢笔工具设置
                            const penSettings = button.parentElement.querySelector('.pen-tool-panel');
                            if (penSettings) {
                                penSettings.style.display = 'flex';
                            }
                            
                            // 显示路径状态面板
                            const statusPanel = button.parentElement.querySelector('.pen-status-panel');
                            if (statusPanel) {
                                statusPanel.style.display = 'block';
                            }
                            
                            // 设置状态更新回调
                            const updatePathStatus = () => {
                                const status = canvas.penTool.getPathStatus();
                                const currentPathElement = statusPanel.querySelector('.current-path-status');
                                const brokenPathsElement = statusPanel.querySelector('.broken-paths-status');
                                
                                // 更新当前路径状态
                                if (status.currentPath) {
                                    const modeText = {
                                        'add': '添加',
                                        'subtract': '减去',
                                        'intersect': '相交',
                                        'replace': '替换'
                                    }[status.currentPath.blendMode] || status.currentPath.blendMode;
                                    
                                    currentPathElement.textContent = `当前路径: ${status.currentPath.points}点 (${modeText}模式)`;
                                } else {
                                    currentPathElement.textContent = "当前路径: 无";
                                }
                                
                                // 更新断开路径状态
                                if (status.brokenPaths.length > 0) {
                                    const pathsText = status.brokenPaths.map(p => {
                                        const modeText = {
                                            'add': '添加',
                                            'subtract': '减去',
                                            'intersect': '相交',
                                            'replace': '替换'
                                        }[p.blendMode] || p.blendMode;
                                        return `${p.name}(${p.points}点,${modeText})`;
                                    }).join(', ');
                                    brokenPathsElement.textContent = `断开路径: ${pathsText}`;
                                } else {
                                    brokenPathsElement.textContent = "断开路径: 无";
                                }
                            };
                            
                            // 设置回调并立即更新
                            canvas.penTool.setPathStatusChangeCallback(updatePathStatus);
                            updatePathStatus();
                            
                        } else {
                            // 停用钢笔工具
                            canvas.penTool.deactivate();
                            
                            // 隐藏钢笔工具设置
                            const penSettings = button.parentElement.querySelector('.pen-tool-panel');
                            if (penSettings) {
                                penSettings.style.display = 'none';
                            }
                            
                            // 隐藏路径状态面板
                            const statusPanel = button.parentElement.querySelector('.pen-status-panel');
                            if (statusPanel) {
                                statusPanel.style.display = 'none';
                            }
                            
                            // 清除状态更新回调
                            canvas.penTool.setPathStatusChangeCallback(null);
                        }
                    }
                }),
                
                // 钢笔工具设置面板
                $el("div.pen-tool-panel", {
                    style: {
                        display: "none",
                        marginLeft: "10px",
                        padding: "2px 8px",
                        border: "1px solid #4a4a4a",
                        borderRadius: "4px",
                        backgroundColor: "#3a3a3a",
                        height: "32px",
                        alignItems: "center",
                        gap: "8px"
                    }
                }, [
                    $el("label", { textContent: "颜色:", style: { color: "white", fontSize: "12px" } }),
                    $el("input", {
                        type: "color",
                        value: "#ff0000",
                        style: { width: "24px", height: "24px", border: "none", borderRadius: "2px" },
                        onchange: function(e) {
                            canvas.penTool.setStrokeColor(e.target.value);
                        }
                    }),
                    $el("label", { textContent: "宽度:", style: { color: "white", fontSize: "12px", marginLeft: "8px" } }),
                    $el("input", {
                        type: "range",
                        min: "1",
                        max: "10",
                        value: "2",
                        style: { width: "60px" },
                        onchange: function(e) {
                            canvas.penTool.setStrokeWidth(parseInt(e.target.value));
                        }
                    }),
                    $el("label", { textContent: "模式:", style: { color: "white", fontSize: "12px", marginLeft: "8px" } }),
                    $el("select", {
                        style: { 
                            fontSize: "11px", 
                            padding: "2px 4px", 
                            backgroundColor: "#2a2a2a", 
                            color: "white", 
                            border: "1px solid #4a4a4a",
                            borderRadius: "2px"
                        },
                        onchange: function(e) {
                            canvas.penTool.setBlendMode(e.target.value);
                        }
                    }, [
                        $el("option", { value: "add", textContent: "添加" }),
                        $el("option", { value: "subtract", textContent: "减去" }),
                        $el("option", { value: "intersect", textContent: "相交" }),
                        $el("option", { value: "replace", textContent: "替换" })
                    ]),
                    $el("button.painter-button", {
                        textContent: "断开",
                        style: { fontSize: "11px", padding: "4px 8px", marginLeft: "8px", height: "24px" },
                        onclick: function() {
                            // 断开当前路径
                            canvas.penTool.breakCurrentPath();
                            // 重新渲染画布
                            canvas.render();
                        }
                    }),
                    $el("button.painter-button", {
                        textContent: "清除",
                        style: { fontSize: "11px", padding: "4px 8px", marginLeft: "2px", height: "24px" },
                        onclick: function() {
                            // 清除钢笔工具的所有路径
                            canvas.penTool.clearAllPaths();
                            // 重新渲染画布
                            canvas.render();
                        }
                    })
                ]),
                
                // 路径状态显示面板
                $el("div.pen-status-panel", {
                    style: {
                        display: "none",
                        marginLeft: "10px",
                        marginTop: "5px",
                        padding: "4px 8px",
                        border: "1px solid #4a4a4a",
                        borderRadius: "4px",
                        backgroundColor: "#2a2a2a",
                        fontSize: "11px",
                        color: "#cccccc",
                        maxWidth: "400px"
                    }
                }, [
                    $el("div.current-path-status", { 
                        textContent: "当前路径: 无",
                        style: { marginBottom: "2px" }
                    }),
                    $el("div.broken-paths-status", { 
                        textContent: "断开路径: 无"
                    })
                ])
            ])
        ])
    ]);

    // 创建ResizeObserver来监控控制面板的高度变化
    const resizeObserver = new ResizeObserver((entries) => {
        const controlsHeight = entries[0].target.offsetHeight;
        const newTop = controlsHeight + 10;
        canvasContainer.style.top = newTop + "px";
        
        // 同时调整底部边距，确保大尺寸画布有足够空间
        const minBottomMargin = canvas.height >= 1024 ? 20 : 15;
        canvasContainer.style.bottom = minBottomMargin + "px";
        
        console.log(`Controls height: ${controlsHeight}px, Canvas container top: ${newTop}px`);
    });

    // 监控控制面板的大小变化
    resizeObserver.observe(controlPanel.querySelector('.controls'));

    // 获取触发器widget
    const triggerWidget = node.widgets.find(w => w.name === "trigger");
    
    // 创建更新函数
    const updateOutput = async () => {
        // 保存画布
        await canvas.saveToServer(widget.value);
        // 更新触发器值
        triggerWidget.value = (triggerWidget.value + 1) % 99999999;
        // 触发节点更新
        app.graph.runStep();
    };

    // 修改所有可能触发更新的操作
    const addUpdateToButton = (button) => {
        const origClick = button.onclick;
        button.onclick = async (...args) => {
            await origClick?.(...args);
            await updateOutput();
        };
    };

    // 为所有按钮添加更新逻辑
    controlPanel.querySelectorAll('button').forEach(addUpdateToButton);

    // 修改画布容器样式，使用动态top值
    const canvasContainer = $el("div.painterCanvasContainer.painter-container", {
        style: {
            position: "absolute",
            top: "60px", // 初始值，会被动态调整
            left: "10px",
            right: "10px", 
            bottom: "15px", // 减少底部边距，为画布提供更多空间
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
            minHeight: "400px" // 确保最小高度
        }
    }, [canvas.canvas]);

    // 修改节点大小调整逻辑
    node.onResize = function() {
        const minSize = 300;
        const controlsElement = controlPanel.querySelector('.controls');
        const controlPanelHeight = controlsElement ? controlsElement.offsetHeight : 60; // 默认高度
        const padding = 20;
        const extraPadding = 40; // 额外边距确保画布完整显示
        
        // 获取当前节点宽度，但确保有最小值
        const nodeWidth = Math.max(this.size[0], minSize);
        
        // 为大尺寸画布（如1024x1024）计算更合适的节点尺寸
        let targetNodeWidth, targetNodeHeight;
        
        if (canvas.width >= 1024 || canvas.height >= 1024) {
            // 大尺寸画布：确保节点足够大以完整显示画布
            const aspectRatio = canvas.height / canvas.width;
            
            // 设置最小节点尺寸以适应大画布
            const minNodeWidth = Math.max(600, nodeWidth);
            const minNodeHeight = Math.max(600, minNodeWidth * aspectRatio + controlPanelHeight + padding * 2 + extraPadding);
            
            targetNodeWidth = minNodeWidth;
            targetNodeHeight = minNodeHeight;
        } else {
            // 普通尺寸画布：使用原来的逻辑但增加额外边距
            targetNodeWidth = nodeWidth;
            targetNodeHeight = Math.max(
                nodeWidth * (canvas.height / canvas.width) + controlPanelHeight + padding * 2 + extraPadding,
                minSize + controlPanelHeight + extraPadding
            );
        }
        
        // 应用计算出的尺寸
        this.size[0] = targetNodeWidth;
        this.size[1] = targetNodeHeight;
        
        // 计算画布的实际可用空间（留出更多边距）
        const availableWidth = targetNodeWidth - padding * 2;
        const availableHeight = targetNodeHeight - controlPanelHeight - padding * 2 - extraPadding;
        
        // 更新画布尺寸，保持比例，但确保不会超出可用空间
        const scaleX = availableWidth / canvas.width;
        const scaleY = availableHeight / canvas.height;
        const scale = Math.min(scaleX, scaleY, 1); // 限制最大缩放为1:1
        
        // 确保画布不会太小
        const minScale = 0.3;
        const finalScale = Math.max(scale, minScale);
        
        canvas.canvas.style.width = (canvas.width * finalScale) + "px";
        canvas.canvas.style.height = (canvas.height * finalScale) + "px";
        
        // 强制重新渲染
        canvas.render();
        
        console.log(`Canvas size adjusted: ${canvas.width}x${canvas.height}, Node: ${targetNodeWidth}x${targetNodeHeight}, Scale: ${finalScale}`);
    };

    // 添加拖拽事件监听
    canvas.canvas.addEventListener('mouseup', updateOutput);
    canvas.canvas.addEventListener('mouseleave', updateOutput);

    // 创建一个包含控制面板和画布的容器
    const mainContainer = $el("div.painterMainContainer", {
        style: {
            position: "relative",
            width: "100%",
            height: "100%"
        }
    }, [controlPanel, canvasContainer]);

    // 将主容器添加到节点
    const mainWidget = node.addDOMWidget("mainContainer", "widget", mainContainer);

    // 设置节点的默认大小，根据画布尺寸调整
    const defaultWidth = canvas.width >= 1024 ? 700 : 500;
    const defaultHeight = canvas.height >= 1024 ? 700 : 500;
    node.size = [defaultWidth, defaultHeight];
    
    // 立即触发一次大小调整，确保画布正确显示
    setTimeout(() => {
        if (node.onResize) {
            node.onResize();
        }
    }, 100);

    // 在执行开始时保存数据
    api.addEventListener("execution_start", async () => {
        // 保存画布
        await canvas.saveToServer(widget.value);
        
        // 保存当前节点的输入数据
        if (node.inputs[0].link) {
            const linkId = node.inputs[0].link;
            const inputData = app.nodeOutputs[linkId];
            if (inputData) {
                ImageCache.set(linkId, inputData);
            }
        }
    });

    // 移除原来在 saveToServer 中的缓存清理
    const originalSaveToServer = canvas.saveToServer;
    canvas.saveToServer = async function(fileName) {
        const result = await originalSaveToServer.call(this, fileName);
        // 移除这里的缓存清理
        // ImageCache.clear();
        return result;
    };

    return {
        canvas: canvas,
        panel: controlPanel
    };
}

// 修改状态指示器类，确保单例模式
class MattingStatusIndicator {
    static instance = null;
    
    static getInstance(container) {
        if (!MattingStatusIndicator.instance) {
            MattingStatusIndicator.instance = new MattingStatusIndicator(container);
        }
        return MattingStatusIndicator.instance;
    }
    
    constructor(container) {
        this.indicator = document.createElement('div');
        this.indicator.style.cssText = `
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: #808080;
            margin-left: 10px;
            display: inline-block;
            transition: background-color 0.3s;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            .processing {
                background-color: #2196F3;
                animation: blink 1s infinite;
            }
            .completed {
                background-color: #4CAF50;
            }
            .error {
                background-color: #f44336;
            }
            @keyframes blink {
                0% { opacity: 1; }
                50% { opacity: 0.4; }
                100% { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        container.appendChild(this.indicator);
    }
    
    setStatus(status) {
        this.indicator.className = ''; // 清除所有状态
        if (status) {
            this.indicator.classList.add(status);
        }
        if (status === 'completed') {
            setTimeout(() => {
                this.indicator.classList.remove('completed');
            }, 2000);
        }
    }
}

// 验证 ComfyUI 的图像数据格式
function validateImageData(data) {
    // 打印完整的输入数据结构
    console.log("Validating data structure:", {
        hasData: !!data,
        type: typeof data,
        isArray: Array.isArray(data),
        keys: data ? Object.keys(data) : null,
        shape: data?.shape,
        dataType: data?.data ? data.data.constructor.name : null,
        fullData: data  // 打印完整数据
    });

    // 检查是否为空
    if (!data) {
        console.log("Data is null or undefined");
        return false;
    }

    // 如果是数组，获取第一个元素
    if (Array.isArray(data)) {
        console.log("Data is array, getting first element");
        data = data[0];
    }

    // 检查数据结构
    if (!data || typeof data !== 'object') {
        console.log("Invalid data type");
        return false;
    }

    // 检查是否有数据属性
    if (!data.data) {
        console.log("Missing data property");
        return false;
    }

    // 检查数据类型
    if (!(data.data instanceof Float32Array)) {
        // 如果不是 Float32Array，尝试转换
        try {
            data.data = new Float32Array(data.data);
        } catch (e) {
            console.log("Failed to convert data to Float32Array:", e);
            return false;
        }
    }

    return true;
}

// 转换 ComfyUI 图像数据为画布可用格式
function convertImageData(data) {
    console.log("Converting image data:", data);
    
    // 如果是数组，获取第一个元素
    if (Array.isArray(data)) {
        data = data[0];
    }

    // 获取维度信息 [batch, height, width, channels]
    const shape = data.shape;
    const height = shape[1];  // 1393
    const width = shape[2];   // 1393
    const channels = shape[3]; // 3
    const floatData = new Float32Array(data.data);
    
    console.log("Processing dimensions:", { height, width, channels });
    
    // 创建画布格式的数据 (RGBA)
    const rgbaData = new Uint8ClampedArray(width * height * 4);
    
    // 转换数据格式 [batch, height, width, channels] -> RGBA
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
            const pixelIndex = (h * width + w) * 4;
            const tensorIndex = (h * width + w) * channels;
            
            // 复制 RGB 通道并转换值范围 (0-1 -> 0-255)
            for (let c = 0; c < channels; c++) {
                const value = floatData[tensorIndex + c];
                rgbaData[pixelIndex + c] = Math.max(0, Math.min(255, Math.round(value * 255)));
            }
            
            // 设置 alpha 通道为完全不透明
            rgbaData[pixelIndex + 3] = 255;
        }
    }
    
    // 返回画布可用的格式
    return {
        data: rgbaData,       // Uint8ClampedArray 格式的 RGBA 数据
        width: width,         // 图像宽度
        height: height        // 图像高度
    };
}

// 处理遮罩数据
function applyMaskToImageData(imageData, maskData) {
    console.log("Applying mask to image data");
    
    const rgbaData = new Uint8ClampedArray(imageData.data);
    const width = imageData.width;
    const height = imageData.height;
    
    // 获取遮罩数据 [batch, height, width]
    const maskShape = maskData.shape;
    const maskFloatData = new Float32Array(maskData.data);
    
    console.log(`Applying mask of shape: ${maskShape}`);
    
    // 将遮罩数据应用到 alpha 通道
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
            const pixelIndex = (h * width + w) * 4;
            const maskIndex = h * width + w;
            // 使遮罩值作为 alpha 值，转换值范围从 0-1 到 0-255
            const alpha = maskFloatData[maskIndex];
            rgbaData[pixelIndex + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        }
    }
    
    console.log("Mask application completed");
    
    return {
        data: rgbaData,
        width: width,
        height: height
    };
}

// 修改缓存管理
const ImageCache = {
    cache: new Map(),
    
    // 存储图像数据
    set(key, imageData) {
        console.log("Caching image data for key:", key);
        this.cache.set(key, imageData);
    },
    
    // 获取图像数据
    get(key) {
        const data = this.cache.get(key);
        console.log("Retrieved cached data for key:", key, !!data);
        return data;
    },
    
    // 检查是否存在
    has(key) {
        return this.cache.has(key);
    },
    
    // 清除缓存
    clear() {
        console.log("Clearing image cache");
        this.cache.clear();
    }
};

// 改进数据准备函数
function prepareImageForCanvas(inputImage) {
    console.log("Preparing image for canvas:", inputImage);
    
    try {
        // 如果是数组，获取第一个元素
        if (Array.isArray(inputImage)) {
            inputImage = inputImage[0];
        }

        if (!inputImage || !inputImage.shape || !inputImage.data) {
            throw new Error("Invalid input image format");
        }

        // 获取维度信息 [batch, height, width, channels]
        const shape = inputImage.shape;
        const height = shape[1];
        const width = shape[2];
        const channels = shape[3];
        const floatData = new Float32Array(inputImage.data);
        
        console.log("Image dimensions:", { height, width, channels });
        
        // 创建 RGBA 格式数据
        const rgbaData = new Uint8ClampedArray(width * height * 4);
        
        // 转换数据格式 [batch, height, width, channels] -> RGBA
        for (let h = 0; h < height; h++) {
            for (let w = 0; w < width; w++) {
                const pixelIndex = (h * width + w) * 4;
                const tensorIndex = (h * width + w) * channels;
                
                // 转换 RGB 通道 (0-1 -> 0-255)
                for (let c = 0; c < channels; c++) {
                    const value = floatData[tensorIndex + c];
                    rgbaData[pixelIndex + c] = Math.max(0, Math.min(255, Math.round(value * 255)));
                }
                
                // 设置 alpha 通道
                rgbaData[pixelIndex + 3] = 255;
            }
        }
        
        // 返回画布需要的格式
        return {
            data: rgbaData,
            width: width,
            height: height
        };
    } catch (error) {
        console.error("Error preparing image:", error);
        throw new Error(`Failed to prepare image: ${error.message}`);
    }
}

app.registerExtension({
    name: "Comfy.CanvasNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeType.comfyClass === "CanvasNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function() {
                const r = onNodeCreated?.apply(this, arguments);
                
                const widget = this.widgets.find(w => w.name === "canvas_image");
                await createCanvasWidget(this, widget, app);
                
                return r;
            };
        }
    }
}); 

async function handleImportInput(data) {
    if (data && data.image) {
        const imageData = data.image;
        await importImage(imageData);
    }
} 

async function importImage(cacheData) {
    try {
        console.log("Starting image import with cache data");
        const img = await this.loadImageFromCache(cacheData.image);
        const mask = cacheData.mask ? await this.loadImageFromCache(cacheData.mask) : null;
        
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
                // 通常取第一个通道值作为亮度
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
            zIndex: this.layers.length
        };
        
        this.layers.push(layer);
        this.selectedLayer = layer;
        this.render();
        
        console.log("Layer imported with mask information");
        
    } catch (error) {
        console.error('Error importing image:', error);
    }
} 