const supplied = process.env["ZUVCODE_VERSION"];
export const zuvCodeVersion = supplied && /^\d+\.\d+\.\d+$/.test(supplied) ? supplied : "0.1.0";
