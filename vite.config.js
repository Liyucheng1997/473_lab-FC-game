import { defineConfig } from 'vite';

// 相对路径，部署到 GitHub Pages 的子目录下也能找到资源
export default defineConfig({ base: './' });
