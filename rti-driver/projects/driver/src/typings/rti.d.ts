interface ConfigStatic {
    Get(name: string): string;
}

declare var Config: ConfigStatic;

interface SystemStatic {
    readonly Version: string
    OnShutdownFunc: () => void | null;
    readonly IPAddress: string;
    readonly MACAddress: string;
    readonly LogLevel: number;
    readonly IPNetMask: string;
    Print(msg: string): boolean;
    PrintMultiline(msg: string): boolean;
    Sleep(time: number): boolean;
    GetURL(url: string): string;
    ConvertFromUTF8(utf8_string: string): string;
    ConvertToUTF8(unicode_string: string): string;
    RunSystemMacro(macro: number): boolean;
    SignalEvent(name: string): boolean;
    SetPriority(priority: number): boolean;
    StartUPnPScan(searchTarget?: string): boolean;
    GetLocalTime(): string;
    GetUTCTime(): string;
    GetLocalTimeInSeconds(): number;
    GetUTCTimeInSeconds(): number;
    Compress(data: string): string;
    Uncompress(data: string, outputSize: number): string;
    GetRandomInteger(low_range: number, high_range: number): number;
    LogError(msg: string): boolean;
    LogInfo(level: number, msg: string): boolean;
    GetViewName(view: number): string;
    LoadResource(resource: string): string;
    Ping(address: string): boolean;
}

declare var System: SystemStatic;

interface PersistenceStatic {
    Write(key: string, value: string): boolean;
    Read(key: string): string;
    Delete(key?: string): boolean;
    Save(): boolean;
}

declare var Persistence: PersistenceStatic;

type HashType = "MD5" | "SHA1" | "SHA224" | "SHA256" | "SHA384" | "SHA512" | "RIPEMD160";

interface CryptoStatic {
    RSAGenerateKey(bits: number): string;
    RSASign(privatekey: string, hashtype: HashType | "NONE", data: string, length: number): string;
    RSAVerify(publickey: string, hashtype: HashType | "NONE", hash: string, hashlength: number, signature: string, signaturelength: number): boolean;
    Hash(digest: HashType, data: string, length: number): string;
    Base64Encode(data: string, length: number): string;
    Base64Decode(data: string, length: number): string;
    RSAEncrypt(publickey: string, data: string, length: number): string;
    RSADecrypt(privatekey: string, data: string, length: number): string;
    GenerateRandomBitstream(bytes: number): string;
    AESEncrypt(data: string, length: number, key: string, iv: string, cipher?: number, padding?: number): string;
    AESDecrypt(data: string, length: number, key: string, iv: string, cipher?: number, padding?: number): string;
    PDKDF2(cipher: string, password: string, iterations: number, salt: string): string;
    ChaCha20Poly1305Decrypt(key: string, nonce: string, data: string, tag?: string): string;
    Argon2(hashtype: string, password: string, salt: string, opslimit: number, memlimit: number, size: number): string;
}

declare var Crypto: CryptoStatic;

interface TCP extends Comm {
    readonly OpenState: number;
    OnConnectFunc: (handle: number) => void;
    OnDisconnectFunc: (handle: number) => void;
    readonly ConnectState: number;
    Open(host?: string, port?: number, instance?: object, rx_buffer_size?: number): boolean;
    Close(): boolean;
}

interface TCPConstructor {
    new(onCommRx: (data: string, handle: number) => void, host?: string, port?: number, instance?: object, rx_buffer_size?: number): TCP
}

declare var TCP: TCPConstructor;

interface TCPServer {
    readonly Handle: number;
    readonly HeartbeatConnectState: boolean;
    UseHandleInCallbacks: boolean;

    Listen: (profileName: 'UPnPEventServer' | 'GenericServer', port: number) => boolean;
    OnClientConnectFunc: (fromaddr: string, channel: number, handle?: number) => void;
    OnClientDisconnectFunc: (channel: number, handle?: number) => void;
    Port: number;
    CloseChannel(channel: number): boolean;
    Write(channel: number, data: string, rxTimeout?: number): boolean;
}

interface TCPServerConstructor {
    new(onCommRx: (channel: number, data: string, handle?: number) => void): TCPServer;
}

declare var TCPServer : TCPServerConstructor;

interface HTTP extends Comm {
    readonly OpenState: number;
    OnConnectFunc: (handle: number) => void;
    OnDisconnectFunc: (handle: number) => void;
    OnSSLHandshakeOKFunc: (handle: number, reason: string) => void;
    OnSSLHandshakeFailedFunc: (handle: number) => void;
    readonly ConnectState: number;
    OnWebsocketUpgradeOKFunct: (httpCode: string, handle: number) => void;
    OnWebsocketUpgradeFailedFunc: (httpCode: string, handle: number) => void;
    SSLHandshakeTimeout: number;
    Open(host?: string, port?: number, instance?: object, rx_buffer_size?: number): boolean;
    Close(): boolean;
    Disconnect(): boolean;
    StartSSLHandshake(): boolean;
    AddCertificateAuthority(certificate: string, mode: number): boolean;
    LoadClientCertificate(certificate: string, key: string, password?: string): boolean;
    UpgradeWebsocket(path?: string): boolean;
    WebsocketAddHeader(name: string, value: string): boolean;
}

interface HTTPConstructor {
    new(onCommRx: (data: string, handle: number) => void, host?: string, port?: number, rx_buffer_size?: number): HTTP
}

declare var HTTP: HTTPConstructor;

interface Comm {
    readonly TxQueueDepth: number;
    readonly Handle: number;
    UseHandleInCallbacks: boolean;
    readonly HeartbeatConnectState: boolean;
    Write(data: string, rxtimeout?: number): boolean;
}

interface CommConstructor {
    new(): Comm;
}

declare var Comm: CommConstructor;

interface Timer {
    readonly Interval: number;
    readonly State: number;
    readonly Handle: number;
    UseHandleInCallbacks: boolean;
    Start(onTimerFunc: (handle: number) => void, timeout: number): boolean;
    Stop(): boolean;
}

interface TimerConstructor {
    new(): Timer;
}

declare var Timer: TimerConstructor;

interface SystemVarsStatic {
    OnSysVarChangeFunc: (variableid: number) => void | null;
    Write(varname: string, data: any, option?: 'BOOLEAN' | 'IMGURL' | 'ForcePropogate'): boolean;
    Read(varname: string): any;
    AddSubscription(id: number): boolean;
    RemoveSubscription(id: number): boolean;
}

declare var SystemVars: SystemVarsStatic;

interface ScheduledEvent {
    Enabled: boolean,
    readonly Handle: number,
    UseHandleInCallbacks: boolean,
    Disable(): boolean;
    Enable(): boolean;
    Reschedule(onEventFunc: (handle: number) => void, type: "Periodic", intervalType: "Minutes" | "Seconds", interval: number): ScheduledEvent;
    Reschedule(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "TimeOfDay", timeOfDay: string, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
    Reschedule(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "Sunrise", sunriseType: "On" | "Before" | "After", offset: number, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
    Reschedule(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "Sunset", sunsetType: "On" | "Before" | "After", offset: number, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
}

interface ScheduledEventConstructor {
    new(onEventFunc: (handle: number) => void, type: "Periodic", intervalType: "Minutes" | "Seconds", interval: number): ScheduledEvent;
    new(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "TimeOfDay", timeOfDay: string, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
    new(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "Sunrise", sunriseType: "On" | "Before" | "After", offset: number, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
    new(onEventFunc: (handle: number) => void, type: "Daily", dailytype : "Sunset", sunsetType: "On" | "Before" | "After", offset: number, daysType: "EVEN" | "ODD" | "BOTH", daysOfWeek: "ALL" | "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"): ScheduledEvent;
}

declare var ScheduledEvent: ScheduledEventConstructor;