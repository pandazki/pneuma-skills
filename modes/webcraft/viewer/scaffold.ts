/**
 * WebCraft scaffold generator — pure function that produces file list from params.
 */

export interface WebFileSpec {
  name: string;
  title?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Generate HTML files from a spec.
 * If no files specified, creates a single index.html.
 */
export function generateWebScaffold(
  files?: WebFileSpec[],
): ScaffoldFile[] {
  if (!files || files.length === 0) {
    return [
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Untitled</title>
</head>
<body>
  <h1>Untitled</h1>
</body>
</html>
`,
      },
    ];
  }

  return files.map((f) => {
    const name = f.name.endsWith(".html") ? f.name : `${f.name}.html`;
    const title = f.title || f.name.replace(/\.html$/, "");
    return {
      path: name,
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
</body>
</html>
`,
    };
  });
}
