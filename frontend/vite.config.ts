import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    server: {
        port: parseInt(process.env.VITE_PORT || "5274"),
        strictPort: true,
    },
    plugins: [react()],
});
