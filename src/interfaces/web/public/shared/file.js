/**
 * Files the operator sends to the API. The API takes them base64-encoded in a
 * JSON body (REQ-218, REQ-219, REQ-247).
 */

/** The file as base64, without the `data:` prefix the reader adds. */
export function base64Of(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
