namespace ProtobufUtil {
    export function CreateMessageLength(message: forge.util.ByteStringBuffer): forge.util.ByteStringBuffer | null {
        let buffer = forge.util.createBuffer();
        buffer.putBytes(
            forge.util.hexToBytes(
                DecimalToHex(message.length())
            )
        );
        return buffer;
    }

    export function CreateVarInt(value: number): forge.util.ByteStringBuffer | null {
        let buffer = forge.util.createBuffer();
        if (value < 128) {
            buffer.putByte(value);
        }
        else if (value < 16383) {
            const valueBinary = DecimalToBinary(value);

            const a = "0" + valueBinary.substr(0, valueBinary.length - 7);
            const b = "1" + valueBinary.substr(-7);

            buffer.putByte(parseInt(b, 2));
            buffer.putByte(parseInt(a, 2));
        }
        else if (value < 2097151) {
            const valueBinary = DecimalToBinary(value);

            const a = "0" + valueBinary.substr(0, valueBinary.length - 14);
            const b = "0" + valueBinary.substr(7, 7);
            const c = "1" + valueBinary.substr(-7);

            buffer.putByte(parseInt(c, 2));
            buffer.putByte(parseInt(b, 2));
            buffer.putByte(parseInt(a, 2));
        }
        else if (value < 268435455) {
            const valueBinary = DecimalToBinary(value);

            const a = "0" + valueBinary.substr(0, valueBinary.length - 21);
            const b = "0" + valueBinary.substr(7, 7);
            const c = "0" + valueBinary.substr(14, 7);
            const d = "1" + valueBinary.substr(-7);

            buffer.putByte(parseInt(d, 2));
            buffer.putByte(parseInt(c, 2));
            buffer.putByte(parseInt(b, 2));
            buffer.putByte(parseInt(a, 2));
        }
        else {
            logger.logTrace("CreateVarInt, value too large");
            return null;
        }

        return buffer;
    }

    export function DecodeKey(key: number) {
        const wireType: WireType = key & 7;
        const fieldNumber = key >>> 3;

        return {FieldNumber: fieldNumber, WiretType: wireType}
    }
    
    export function EncodeKey(fieldNumber: number, wireType: WireType ): forge.util.ByteStringBuffer | null {
        const key = (fieldNumber << 3) | wireType;
        return CreateVarInt(key);
    }

    export function ReadMessageLength(buffer: forge.util.ByteStringBuffer): number | null {
        if (!buffer || buffer.length() < 1) { return null; }

        let bufferCopy = forge.util.createBuffer(buffer);

        let lengthBytes = forge.util.createBuffer();

        while (bufferCopy.length() > 0) {
            let byte = bufferCopy.getByte();
            lengthBytes.putByte(byte)

            if ((byte & 255) != 255) {  // Not overflowing to next byte
                buffer.getBytes(lengthBytes.length());  // Move pointer to end of UInt32
                return lengthBytes.getInt(lengthBytes.length() * 8);
            }
        }

        return null;  // Not enough bytes
    }

    export function ReadVarInt(buffer: forge.util.ByteStringBuffer): number | null {
        if (!buffer || buffer.length() < 1) { return null; }

        let bufferCopy = forge.util.createBuffer(buffer);

        let lengthBits = new Array<string>();

        while (bufferCopy.length() > 0)
        {
            let byte = bufferCopy.getByte();
            lengthBits.push(DecimalToBinary(byte));

            if ((byte & 128) != 128) {  // MSB not set, last byte
                buffer.getBytes(buffer.length() - bufferCopy.length());  // Move pointer to end of UInt32
                return parseInt(lengthBits.reverse().join(''), 2);
            }
        }

        return null;  // Not enough bytes
    }

    function DecimalToBinary(dec: number): string {
        return (dec >>> 0).toString(2);
    }

    function DecimalToHex(dec: number): string {
        const hex = (dec >>> 0).toString(16);
        return (hex.length % 2 == 0) ? hex : "0" + hex;
    }

    export enum WireType {
        VarInt = 0,
        SixtyFourBit = 1,
        LengthDelimited = 2,
        StartGroup = 3,
        EndGroup = 4,
        ThirtyTwoBit = 5
    }
}