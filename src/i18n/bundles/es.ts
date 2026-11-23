import { namespaces } from "./namespaces.js";

export default namespaces(import.meta.glob("../locales/es/*.json", { eager: true, import: "default" }));
