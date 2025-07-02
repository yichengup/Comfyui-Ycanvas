/**
 * Canvas混合模式管理器
 * 负责处理图层混合模式和透明度相关功能
 */
export class CanvasBlendMode {
    
    /**
     * 获取混合模式列表
     * @returns {Array} 混合模式列表
     */
    static getBlendModes() {
        return [
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
    }

    /**
     * 显示混合模式菜单
     * @param {Canvas} canvas - Canvas实例
     * @param {number} x - 菜单X坐标
     * @param {number} y - 菜单Y坐标
     */
    static showBlendModeMenu(canvas, x, y) {
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

        const blendModes = this.getBlendModes();
        
        blendModes.forEach(mode => {
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
            slider.value = canvas.selectedLayer.opacity ? Math.round(canvas.selectedLayer.opacity * 100) : 100;
            slider.style.cssText = `
                width: 100%;
                margin: 5px 0;
                display: none;
            `;

            // 如果是当前图层的混合模式，显示滑动条
            if (canvas.selectedLayer.blendMode === mode.name) {
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
                if (canvas.selectedLayer) {
                    canvas.selectedLayer.blendMode = mode.name;
                    canvas.render();
                }
            };

            // 添加滑动条的input事件（实时更新）
            slider.addEventListener('input', () => {
                if (canvas.selectedLayer) {
                    canvas.selectedLayer.opacity = slider.value / 100;
                    canvas.render();
                }
            });

            // 添加滑动条的change事件（结束拖动时保存状态）
            slider.addEventListener('change', async () => {
                if (canvas.selectedLayer) {
                    canvas.selectedLayer.opacity = slider.value / 100;
                    canvas.render();
                    // 保存到服务器并更新节点
                    await canvas.saveToServer(canvas.widget.value);
                    if (canvas.node) {
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

    /**
     * 处理混合模式选择
     * @param {Canvas} canvas - Canvas实例
     * @param {string} mode - 混合模式名称
     */
    static handleBlendModeSelection(canvas, mode) {
        if (canvas.selectedBlendMode === mode && !canvas.isAdjustingOpacity) {
            // 第二次点击，应用效果
            this.applyBlendMode(canvas, mode, canvas.blendOpacity);
            this.closeBlendModeMenu();
        } else {
            // 第一次点击，显示透明度调整器
            canvas.selectedBlendMode = mode;
            canvas.isAdjustingOpacity = true;
            this.showOpacitySlider(canvas, mode);
        }
    }

    /**
     * 显示透明度滑动条
     * @param {Canvas} canvas - Canvas实例
     * @param {string} mode - 混合模式名称
     */
    static showOpacitySlider(canvas, mode) {
        // 创建滑动条
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = canvas.blendOpacity;
        slider.className = 'blend-opacity-slider';
        
        slider.addEventListener('input', (e) => {
            canvas.blendOpacity = parseInt(e.target.value);
            // 可以添加实时预览效果
        });
        
        // 将滑动条添加到对应的混合模式选项下
        const modeElement = document.querySelector(`[data-blend-mode="${mode}"]`);
        if (modeElement) {
            modeElement.appendChild(slider);
        }
    }

    /**
     * 应用混合模式和透明度
     * @param {Canvas} canvas - Canvas实例
     * @param {string} mode - 混合模式名称
     * @param {number} opacity - 透明度（0-100）
     */
    static applyBlendMode(canvas, mode, opacity) {
        if (canvas.selectedLayer) {
            // 应用混合模式和透明度
            canvas.selectedLayer.blendMode = mode;
            canvas.selectedLayer.opacity = opacity / 100;
            
            // 重新渲染画布
            canvas.render();
        }
        
        // 清理状态
        canvas.selectedBlendMode = null;
        canvas.isAdjustingOpacity = false;
    }

    /**
     * 关闭混合模式菜单
     */
    static closeBlendModeMenu() {
        const menu = document.getElementById('blend-mode-menu');
        if (menu) {
            document.body.removeChild(menu);
        }
    }

    /**
     * 重置图层混合模式
     * @param {Object} layer - 图层对象
     */
    static resetLayerBlendMode(layer) {
        if (layer) {
            layer.blendMode = 'normal';
            layer.opacity = 1;
        }
    }

    /**
     * 获取图层当前混合模式信息
     * @param {Object} layer - 图层对象
     * @returns {Object} 混合模式信息
     */
    static getLayerBlendInfo(layer) {
        if (!layer) return null;
        
        return {
            blendMode: layer.blendMode || 'normal',
            opacity: layer.opacity !== undefined ? layer.opacity : 1,
            opacityPercent: Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100)
        };
    }

    /**
     * 设置图层混合模式
     * @param {Object} layer - 图层对象
     * @param {string} blendMode - 混合模式名称
     * @param {number} opacity - 透明度（0-1）
     */
    static setLayerBlendMode(layer, blendMode, opacity) {
        if (!layer) return;
        
        layer.blendMode = blendMode || 'normal';
        if (opacity !== undefined) {
            layer.opacity = Math.max(0, Math.min(1, opacity));
        }
    }

    /**
     * 复制图层混合模式设置
     * @param {Object} sourceLayer - 源图层
     * @param {Object} targetLayer - 目标图层
     */
    static copyBlendModeSettings(sourceLayer, targetLayer) {
        if (!sourceLayer || !targetLayer) return;
        
        targetLayer.blendMode = sourceLayer.blendMode || 'normal';
        targetLayer.opacity = sourceLayer.opacity !== undefined ? sourceLayer.opacity : 1;
    }

    /**
     * 预览混合模式效果（不实际应用）
     * @param {Canvas} canvas - Canvas实例
     * @param {string} mode - 混合模式名称
     * @param {number} opacity - 透明度（0-1）
     */
    static previewBlendMode(canvas, mode, opacity) {
        if (!canvas.selectedLayer) return;
        
        // 保存原始设置
        const originalBlendMode = canvas.selectedLayer.blendMode;
        const originalOpacity = canvas.selectedLayer.opacity;
        
        // 临时应用新设置
        canvas.selectedLayer.blendMode = mode;
        canvas.selectedLayer.opacity = opacity;
        
        // 渲染预览
        canvas.render();
        
        // 还原原始设置（如果需要）
        // canvas.selectedLayer.blendMode = originalBlendMode;
        // canvas.selectedLayer.opacity = originalOpacity;
    }

    /**
     * 获取混合模式的描述信息
     * @param {string} mode - 混合模式名称
     * @returns {string} 描述信息
     */
    static getBlendModeDescription(mode) {
        const descriptions = {
            'normal': '正常混合，不改变颜色',
            'multiply': '正片叠底，颜色变暗',
            'screen': '滤色，颜色变亮',
            'overlay': '叠加，增强对比度',
            'darken': '变暗，选择较暗的颜色',
            'lighten': '变亮，选择较亮的颜色',
            'color-dodge': '颜色减淡，增亮底色',
            'color-burn': '颜色加深，加深底色',
            'hard-light': '强光，强烈的对比效果',
            'soft-light': '柔光，柔和的对比效果',
            'difference': '差值，颜色相减',
            'exclusion': '排除，类似差值但对比度更低'
        };
        
        return descriptions[mode] || '未知混合模式';
    }
} 