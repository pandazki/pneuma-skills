import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/ko/*.json", { eager: true, import: "default" }));
