import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/en/*.json", { eager: true, import: "default" }));
