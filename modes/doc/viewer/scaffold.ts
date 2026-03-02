/**
 * Doc scaffold generator — pure function that produces file list from params.
 */

export interface DocFileSpec {
  name: string;
  heading?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Generate markdown files from a spec.
 * If no files specified, creates a single README.md.
 */
export function generateDocScaffold(
  files?: DocFileSpec[],
): ScaffoldFile[] {
  if (!files || files.length === 0) {
    return [{ path: "README.md", content: "# Untitled\n" }];
  }

  return files.map((f) => {
    const name = f.name.endsWith(".md") ? f.name : `${f.name}.md`;
    const heading = f.heading || f.name.replace(/\.md$/, "");
    return { path: name, content: `# ${heading}\n` };
  });
}
