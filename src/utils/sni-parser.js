/**
 * SNI Parser - Extracts Server Name Indication from TLS ClientHello
 *
 * This module parses the TLS ClientHello packet to extract the SNI extension
 * without decrypting the connection (TLS passthrough).
 *
 * TLS ClientHello Structure:
 * - Content Type (1 byte): 0x16 (Handshake)
 * - TLS Version (2 bytes)
 * - Length (2 bytes)
 * - Handshake Type (1 byte): 0x01 (ClientHello)
 * - Handshake Length (3 bytes)
 * - ClientHello Version (2 bytes)
 * - Random (32 bytes)
 * - Session ID Length (1 byte)
 * - Session ID (variable)
 * - Cipher Suites Length (2 bytes)
 * - Cipher Suites (variable)
 * - Compression Methods Length (1 byte)
 * - Compression Methods (variable)
 * - Extensions Length (2 bytes)
 * - Extensions (variable)
 *   - Extension Type (2 bytes): 0x0000 (SNI)
 *   - Extension Length (2 bytes)
 *   - Server Name List Length (2 bytes)
 *   - Server Name Type (1 byte): 0x00 (host_name)
 *   - Server Name Length (2 bytes)
 *   - Server Name (variable)
 */

/**
 * Parse SNI from TLS ClientHello buffer
 * @param {Buffer} buffer - Raw TLS ClientHello packet
 * @returns {string|null} - SNI hostname or null if not found
 */
export function parseSNI(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  try {
    // Check if this is a TLS handshake (0x16)
    if (buffer.length < 5 || buffer[0] !== 0x16) {
      return null;
    }

    // Check if this is ClientHello (0x01)
    if (buffer[5] !== 0x01) {
      return null;
    }

    // Start parsing from offset 43 (skip to Session ID)
    let offset = 43;

    // Skip Session ID
    if (offset >= buffer.length) return null;
    const sessionIdLength = buffer[offset];
    offset += 1 + sessionIdLength;

    // Skip Cipher Suites
    if (offset + 1 >= buffer.length) return null;
    const cipherSuitesLength = buffer.readUInt16BE(offset);
    offset += 2 + cipherSuitesLength;

    // Skip Compression Methods
    if (offset >= buffer.length) return null;
    const compressionMethodsLength = buffer[offset];
    offset += 1 + compressionMethodsLength;

    // Check for Extensions
    if (offset + 1 >= buffer.length) return null;
    const extensionsLength = buffer.readUInt16BE(offset);
    offset += 2;

    const extensionsEnd = offset + extensionsLength;

    // Parse Extensions
    while (offset + 3 < extensionsEnd && offset + 3 < buffer.length) {
      const extensionType = buffer.readUInt16BE(offset);
      const extensionLength = buffer.readUInt16BE(offset + 2);
      offset += 4;

      // SNI Extension Type is 0x0000
      if (extensionType === 0x0000) {
        // Parse SNI
        if (offset + 4 >= buffer.length) return null;

        const serverNameListLength = buffer.readUInt16BE(offset);
        offset += 2;

        if (offset + 2 >= buffer.length) return null;

        const serverNameType = buffer[offset]; // Should be 0x00 for host_name
        const serverNameLength = buffer.readUInt16BE(offset + 1);
        offset += 3;

        if (serverNameType === 0x00 && offset + serverNameLength <= buffer.length) {
          const serverName = buffer.toString('utf8', offset, offset + serverNameLength);
          return serverName;
        }

        return null;
      }

      // Skip to next extension
      offset += extensionLength;
    }

    return null;
  } catch (error) {
    // Parsing error - invalid packet structure
    return null;
  }
}

/**
 * Check if buffer contains enough data for SNI parsing
 * @param {Buffer} buffer - Buffer to check
 * @returns {boolean} - True if buffer is likely complete enough
 */
export function hasEnoughDataForSNI(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }

  // Check TLS content type (0x16 = Handshake)
  if (buffer[0] !== 0x16) {
    return false;
  }

  // Read TLS record length (bytes 3-4)
  const recordLength = buffer.readUInt16BE(3);

  // Check if we have the complete record
  return buffer.length >= recordLength + 5;
}

export default {
  parseSNI,
  hasEnoughDataForSNI,
};
