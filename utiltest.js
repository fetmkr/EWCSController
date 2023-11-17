
import path from 'path'
function test() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    
  

    const timestamp = Date.now(); // Epoch timestamp in UTC
    const urlPath = path.join(`${year}-${month}`,`${timestamp}.jpg`)
    console.log(urlPath)
}
test()