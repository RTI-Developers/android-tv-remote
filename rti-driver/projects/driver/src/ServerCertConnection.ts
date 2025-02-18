class ServerCertConnection {
    socketHandle: number;
    socketTimeoutTimerHandler: number;
    
    private readonly _certRetrieved: (cert: forge.pki.Certificate) => void;
    private readonly _logger: Logger;
    private readonly _loggerContext: string;
    private readonly _socket: TCP;

    private _currentRecord: { size: number, type: number } | null = null;
    private _socketTimeoutTimer: Timer;
    private _receivedDataBuffer: forge.util.ByteBuffer;
    
    constructor(
        ipAddress: string,
        port: number,
        certRetrieved: (cert: forge.pki.Certificate) => void,
        onCommRx: (data: string, handle: number) => void,
        onConnect: (handle: number) => void,
        onDisconnect: (handle: number) => void,
        onSocketTimeout: (handle: number) => void,
        logger: Logger) {
        this._logger = logger;
        this._loggerContext = "ServerCertConnection (" + ipAddress + ":" + port + ")";
        
        logger.logTrace("consturctor", this._loggerContext);

        this._receivedDataBuffer = forge.util.createBuffer();
        this._logger.logTrace("_receivedDataBuffer length after creation [" + this._receivedDataBuffer.length() + "]", this._loggerContext);

        this._certRetrieved = certRetrieved;

        this._socket = new TCP(onCommRx);
        this._socket.OnConnectFunc = onConnect;
        this._socket.OnDisconnectFunc = onDisconnect;
        this._socket.UseHandleInCallbacks = true;
        this.socketHandle = this._socket.Handle;

        logger.logTrace("opening socket", this._loggerContext);
        this._socket.Open(ipAddress, port);

        this._socketTimeoutTimer = new Timer();
        this._socketTimeoutTimer.UseHandleInCallbacks = false;
        this._socketTimeoutTimer.Start(onSocketTimeout, 5000);
        this.socketTimeoutTimerHandler = this._socketTimeoutTimer.Handle;
    }

    onCommRx(data: string) {
        this._logger.logTrace("onCommRx", this._loggerContext);
        this._logger.logTrace("data length (" + data.length + ")", this._loggerContext);

        this._logger.logTrace("_receivedDataBuffer length before putString [" + this._receivedDataBuffer.length() + "]", this._loggerContext);

        this._receivedDataBuffer.putBytes(data);

        this._logger.logTrace("_receivedDataBuffer length after putString [" + this._receivedDataBuffer.length() + "]", this._loggerContext);
        
        this.processRecords();
    }

    onConnect() {
        this._logger.logTrace("onConnect", this._loggerContext);

        if (this._socketTimeoutTimer.State == 1) {
            this._socketTimeoutTimer.Stop();
        }

        // Send Client Hello TLS Message (message bytes taken from OpenSSL connection to Nvidia Shield `openssl.exe s_client -connect <ip>:<port> -showcerts -msg -msgfile <msg log file>)
        const clientHelloMessage = forge.util.hexToBytes("16030101200100011c0303f4cf7a3087f34f7eaa94577ccd02e4021aaabb78ea857abca85b0800021b929a207286b5d19160833634734b5a417cf881ee8eee34b11f00ff0fca5d862e911593003e130213031301c02cc030009fcca9cca8ccaac02bc02f009ec024c028006bc023c0270067c00ac0140039c009c0130033009d009c003d003c0035002f00ff01000095000b000403000102000a000c000a001d0017001e00190018002300000016000000170000000d0030002e040305030603080708080809080a080b080408050806040105010601030302030301020103020202040205020602002b0009080304030303020301002d00020101003300260024001d00203febe3e5d7b0d580d6574e91f33dc6f59554d3adab2e0381ddfde0d9e4291828");
        
        logger.logTrace("writing client hello message: [" + clientHelloMessage + "]", this._loggerContext);
        this._socket.Write(clientHelloMessage);
    }

    onDisconnect() {
        this._logger.logTrace("onDisconnect", this._loggerContext);
        this.cleanUp();
    }

    onSocketTimeout() {
        this._logger.logTrace("onSocketTimeout", this._loggerContext);
        this.cleanUp();
    }

    private cleanUp() {
        this._logger.logTrace("cleanUp", this._loggerContext);
        this._receivedDataBuffer.clear();

        if(this._socketTimeoutTimer.State == 1) {
            this._socketTimeoutTimer.Stop();
        }

        if (this._socket.OpenState == 1) {
            this._socket.Close();
        }
    }

    private logBytes(label: string, buffer: forge.util.ByteStringBuffer) {
        let datadump = buffer.copy();
        this._logger.logTrace('start ' + label + " data:", this._loggerContext);

        while (datadump.length() > 0) {
            const hex = forge.util.bytesToHex(datadump.getBytes(16)).replace(/(.{2})/g, "$&" + " ");
            this._logger.logTrace(hex);
        }

        this._logger.logTrace('end ' + label + " data:", this._loggerContext);
    }

    private processRecords() {
        this._logger.logTrace("processRecords", this._loggerContext);

        this.logBytes("_receivedDataBuffer", this._receivedDataBuffer);

        if (!this._currentRecord) {

            if (this._receivedDataBuffer.length() < 5) {
                this._logger.logTrace("Not enough data for new record", this._loggerContext);
                return;
            }

            // Read current record header
            const recordType = this._receivedDataBuffer.getInt(8);  // 1 Bytes
            const majorProtocolVersion = this._receivedDataBuffer.getInt(8);  // 1 Bytes
            const minorProtocolVersion = this._receivedDataBuffer.getInt(8);  // 1 Bytes
            const recordBytes = this._receivedDataBuffer.getInt(16);  // 2 Bytes

            this._logger.logTrace("New record, type [" + recordType + "] with length [" + recordBytes + "]", this._loggerContext);

            this._currentRecord = {
                type: recordType,
                size: recordBytes
            }
        }

        if (this._receivedDataBuffer.length() >= this._currentRecord.size) {  // Current record is complete
            this._logger.logTrace("Processing complete record, type [" + this._currentRecord.type + "] with length [" + this._currentRecord.size + "]", this._loggerContext);
            this._logger.logTrace("_receivedDataBuffer length before record extration [" + this._receivedDataBuffer.length() + "]", this._loggerContext);

            // Remove current record data from this._receivedDataBuffer and copy to recordDataBuffer
            const recordDataBuffer = forge.util.createBuffer(this._receivedDataBuffer.getBytes(this._currentRecord.size));

            this._logger.logTrace("_receivedDataBuffer length after record extration [" + this._receivedDataBuffer.length() + "]", this._loggerContext);
        
            const recordSize = this._currentRecord.size;
            const recordType = this._currentRecord.type;

            this._currentRecord = null;
            
            this._logger.logTrace("Created recordDataBuffer with length [" + recordDataBuffer.length() + "]", this._loggerContext);

            this.logBytes("recordDataBuffer", recordDataBuffer);

            if (recordType !== 22) {  // Not a handshake record (0x16), ignore
                recordDataBuffer.clear();
                this.processRecords();  // Check next record if one exists
                return;
            }

            const handshakeType = recordDataBuffer.getInt(8);  // 1 Byte
            const handshakeBytes = recordDataBuffer.getInt(24);  // 3 Bytes

            this._logger.logTrace("Handshake, type [" + handshakeType + "] with length [" + handshakeBytes + "]", this._loggerContext);

            if (handshakeType !== 11) {  // Not a certificate handshake (0x0b), ignore
                recordDataBuffer.clear();
                this.processRecords();  // Check next record if one exists
                return;
            }

            const totalCertificateBytes = recordDataBuffer.getInt(24);  // 3 Bytes

            this._logger.logTrace("Certificates with total length [" + totalCertificateBytes + "]", this._loggerContext);

            if (totalCertificateBytes > recordDataBuffer.length()) {
                this._logger.logError("Total Certificate Bytes > Remaining Record Bytes", this._loggerContext);
                recordDataBuffer.clear();
                this.processRecords();  // Check next record if one exists
                return;
            }

            let certificateBytesRead = 0;
            let certificates: string[] = [];

            while (certificateBytesRead < totalCertificateBytes) {
                this._logger.logTrace("Reading Certificate Value", this._loggerContext);
                const certificateBytes = recordDataBuffer.getInt(24);  // 3 Bytes
                certificates.push(recordDataBuffer.getBytes(certificateBytes));
                certificateBytesRead += (3 + certificateBytes);
            }           

            const forgeCert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(certificates[0]));
            
            this._logger.logTrace("Cert PubKey Modulus [" + forgeCert.publicKey.n.abs().toString(16) + "]", this._loggerContext);
            this._logger.logTrace("Cert PubKey Exponent [" + forgeCert.publicKey.e.abs().toString(16) + "]", this._loggerContext);

            this._certRetrieved(forgeCert);

            // Server certificates retrieved, our work is done
            recordDataBuffer.clear();
            this.cleanUp();
        }
    }
}