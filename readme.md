# vList Server for nJS
(为`njs`设计的vList5后端，适用于Nginx NJS >= 0.80)

## 使用

首先需要使用tsc编译为`main.js`，使用`tsc --target ES2022 main.ts`
接下来在nginx配置文件`server`块中添加：

    js_import main.js;
    location = /@api/{
        js_content main.main;
    }

保存重启