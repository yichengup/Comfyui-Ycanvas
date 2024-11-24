import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { Canvas } from "./Canvas.js";

async function createCanvasWidget(node, widget, app) {
    const canvas = new Canvas(node, widget);

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
                minHeight: "50px", // 改为最小高度
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
            // 添加监听器来动态整画布容器的位置
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
                                await canvas.importImage({
                                    image: result.data.image,
                                    mask: result.data.mask
                                });
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
            })
        ])
    ]);

    // 创建ResizeObserver来监控控制面板的高度变化
    const resizeObserver = new ResizeObserver((entries) => {
        const controlsHeight = entries[0].target.offsetHeight;
        canvasContainer.style.top = (controlsHeight + 10) + "px";
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
            top: "60px", // 初始值
            left: "10px",
            right: "10px",
            bottom: "10px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden"
        }
    }, [canvas.canvas]);

    // 修改节点大小调整逻辑
    node.onResize = function() {
        const minSize = 300;
        const controlsElement = controlPanel.querySelector('.controls');
        const controlPanelHeight = controlsElement.offsetHeight; // 取实际高
        const padding = 20;
        
        // 保持节点宽度，高度根据画布比例调整
        const width = Math.max(this.size[0], minSize);
        const height = Math.max(
            width * (canvas.height / canvas.width) + controlPanelHeight + padding * 2,
            minSize + controlPanelHeight
        );
        
        this.size[0] = width;
        this.size[1] = height;
        
        // 计算画布的实际可用空间
        const availableWidth = width - padding * 2;
        const availableHeight = height - controlPanelHeight - padding * 2;
        
        // 更新画布尺寸，保持比例
        const scale = Math.min(
            availableWidth / canvas.width,
            availableHeight / canvas.height
        );
        
        canvas.canvas.style.width = (canvas.width * scale) + "px";
        canvas.canvas.style.height = (canvas.height * scale) + "px";
        
        // 强制重新渲染
        canvas.render();
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

    // 设置节点的默认大小
    node.size = [500, 500]; // 设置初始大小为正方形

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
