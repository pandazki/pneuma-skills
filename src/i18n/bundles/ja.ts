import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/ja/*.json", { eager: true, import: "default" }));
