/**
 * Canvas工具函数集合
 * 包含文件保存、数据转换、图像处理等低频调用的工具方法
 */
export class CanvasUtils {
    
    /**
     * 保存画布到服务器
     * @param {Canvas} canvas - Canvas实例
     * @param {string} fileName - 文件名
     * @returns {Promise<boolean>} 保存是否成功
     */
    static async saveToServer(canvas, fileName) {
        return new Promise((resolve) => {
            // 创建临时画布
            const tempCanvas = document.createElement('canvas');
            const maskCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            
            const tempCtx = tempCanvas.getContext('2d');
            const maskCtx = maskCanvas.getContext('2d');

            // 填充白色背景
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, canvas.width, canvas.height);
            
            // 填充黑色背景作为遮罩的基础 - 保持黑色背景
            maskCtx.fillStyle = '#000000';
            maskCtx.fillRect(0, 0, canvas.width, canvas.height);

            // 按照zIndex顺序绘制所有图层
            canvas.layers.sort((a, b) => a.zIndex - b.zIndex).forEach(layer => {
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
                                    canvas.widget.value = data.name;
                                    // 触发节点更新
                                    if (canvas.node) {
                                        canvas.node.setDirtyCanvas(true);
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

    /**
     * 转换张量为图像数据
     * @param {Object} tensor - 张量数据
     * @returns {ImageData|null} 图像数据
     */
    static convertTensorToImageData(tensor) {
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
                    // 根据实际值范围进行映射
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

    /**
     * 从图像数据创建图像对象
     * @param {ImageData} imageData - 图像数据
     * @returns {Promise<Image>} 图像对象
     */
    static async createImageFromData(imageData) {
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

    /**
     * 从缓存加载图像
     * @param {string} base64Data - base64图像数据
     * @returns {Promise<Image>} 图像对象
     */
    static async loadImageFromCache(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = base64Data;
        });
    }

    /**
     * 转换张量为图像
     * @param {Object} tensor - 张量数据
     * @returns {Promise<Image>} 图像对象
     */
    static async convertTensorToImage(tensor) {
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

            // 创建像素数据
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

    /**
     * 转换张量为遮罩
     * @param {Object} tensor - 张量数据
     * @returns {Promise<Float32Array>} 遮罩数据
     */
    static async convertTensorToMask(tensor) {
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

    /**
     * 验证图像数据
     * @param {Object} data - 图像数据
     * @returns {boolean} 是否有效
     */
    static validateImageData(data) {
        console.log("Validating data structure:", {
            hasData: !!data,
            type: typeof data,
            isArray: Array.isArray(data),
            keys: data ? Object.keys(data) : null,
            shape: data?.shape,
            dataType: data?.data ? data.data.constructor.name : null,
            fullData: data
        });

        if (!data) {
            console.log("No data provided");
            return false;
        }

        if (Array.isArray(data)) {
            console.log("Data is array, checking first element");
            data = data[0];
        }

        const hasValidShape = data.shape && Array.isArray(data.shape) && data.shape.length >= 3;
        const hasValidData = data.data && (data.data instanceof Float32Array || 
                                         data.data instanceof Uint8Array || 
                                         data.data instanceof Array);

        console.log("Validation result:", {
            hasValidShape,
            hasValidData,
            shape: data.shape,
            dataLength: data.data ? data.data.length : 0
        });

        return hasValidShape && hasValidData;
    }

    /**
     * 转换图像数据格式
     * @param {Object} data - 原始数据
     * @returns {Object} 转换后的数据
     */
    static convertImageData(data) {
        try {
            if (Array.isArray(data)) {
                data = data[0];
            }

            if (!this.validateImageData(data)) {
                throw new Error("Invalid image data structure");
            }

            const shape = data.shape;
            const width = shape[2];
            const height = shape[1];
            const channels = shape[3] || shape[0];

            console.log("Converting image data:", {
                width, height, channels,
                dataType: data.data.constructor.name,
                dataLength: data.data.length
            });

            return {
                width,
                height,
                channels,
                data: data.data,
                shape: shape,
                min_val: data.min_val || 0,
                max_val: data.max_val || 1
            };
        } catch (error) {
            console.error("Error converting image data:", error);
            throw error;
        }
    }

    /**
     * 应用遮罩到图像数据
     * @param {ImageData} imageData - 图像数据
     * @param {Float32Array} maskData - 遮罩数据
     * @returns {ImageData} 应用遮罩后的图像数据
     */
    static applyMaskToImageData(imageData, maskData) {
        if (!imageData || !maskData) {
            throw new Error("Missing image or mask data");
        }

        const result = new ImageData(imageData.width, imageData.height);
        result.data.set(imageData.data);

        for (let i = 0; i < maskData.length; i++) {
            const pixelIndex = i * 4;
            if (pixelIndex + 3 < result.data.length) {
                result.data[pixelIndex + 3] = Math.round(maskData[i] * 255);
            }
        }

        return result;
    }

    /**
     * 准备图像用于画布
     * @param {Object} inputImage - 输入图像数据
     * @returns {Object} 处理后的图像数据
     */
    static prepareImageForCanvas(inputImage) {
        try {
            console.log("Preparing image for canvas:", inputImage);
            
            if (!inputImage) {
                throw new Error("No input image provided");
            }

            // 处理不同的输入格式
            let processedData;
            
            if (Array.isArray(inputImage)) {
                processedData = inputImage[0];
            } else {
                processedData = inputImage;
            }

            if (!this.validateImageData(processedData)) {
                console.error("Invalid image data format");
                return null;
            }

            return this.convertImageData(processedData);
        } catch (error) {
            console.error("Error preparing image for canvas:", error);
            return null;
        }
    }
} 