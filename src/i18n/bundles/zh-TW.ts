import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/zh-TW/*.json", { eager: true, import: "default" }));
