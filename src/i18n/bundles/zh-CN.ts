import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/zh-CN/*.json", { eager: true, import: "default" }));
