// Standalone browsers do not provide Claude's downloads capability.
export async function saveBrowserDownload({ filename, data }) {
  const type = filename.endsWith(".json")
    ? "application/json;charset=utf-8"
    : "text/plain;charset=utf-8";
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive long enough for the browser to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
