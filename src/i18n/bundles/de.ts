import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/de/*.json", { eager: true, import: "default" }));
