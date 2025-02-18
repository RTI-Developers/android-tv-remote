const COMPANION_APP_HOST = 'rtiandroidtvcompanion.noesislabs.com';
const COMPANION_APP_PACKAGE_NAME = 'com.noesislabs.rtiandroidtvcompanion';
const COMPANION_APP_SCHEME = 'https';

const controlPort = 6466;
const certPersistenceKey = "Certificate";
const enablePairingConfigKey = "EnablePairing";
const enableTraceConfigKey = "EnableTrace";
const ipAddressConfigKeyPrefix = "IPAddress";
const maxPersistenceValueSize = 256;
const mediaNotificationInterfacePortConfigKey = "MediaNotificationInterfacePort";
const mediaPositionTimerInterval = 250;
const nameConfigKeyPrefix = "AndroidTvName";
const pairingInterfacePortConfigKey = "PairingInterfacePort";
const pairingPort = 6467;
const privateKeyPersistenceKey = "PrivateKey";
const sendKeyTimeout = 50;
const sendKeyTimerInterval = 10;
const useCompanionAppConfigKeyPrefix = "UseCompanionApp";

const logger = new Logger("Android TV Driver:", Config.Get(enableTraceConfigKey) == "true");
const deviceCount = parseInt((Config.Get("DeviceCount")), 10);

logger.logInfo("Initializing...");

let privateKeyPem = PersistenceHelpers.ReadChunked(privateKeyPersistenceKey);
let certificatePem = PersistenceHelpers.ReadChunked(certPersistenceKey);

if (!privateKeyPem || !certificatePem) {
    logger.logInfo("Generating new key pair.");

    let publicKeyPem = '';
    [privateKeyPem, publicKeyPem] = Crypto.RSAGenerateKey(1024).split("\r\n\r\n");

    const certificate = generateX509Certificate(
        forge.pki.publicKeyFromPem(publicKeyPem),
        forge.pki.privateKeyFromPem(privateKeyPem)
    );

    verifyCertificate(certificate);

    certificatePem = forge.pki.certificateToPem(certificate);

    PersistenceHelpers.WriteChunked(privateKeyPersistenceKey, privateKeyPem, maxPersistenceValueSize);
    PersistenceHelpers.WriteChunked(certPersistenceKey, certificatePem, maxPersistenceValueSize);

    Persistence.Save();
}

logTraceLargeString('private', privateKeyPem);
logTraceLargeString('certificate', certificatePem);

const isPairingWebHostEnabled: boolean = Config.Get(enablePairingConfigKey) == "true";
const configurationHost: ConfigurationHost | null = (isPairingWebHostEnabled) ? 
    new ConfigurationHost(
        parseInt(Config.Get(pairingInterfacePortConfigKey)),
        ConfigurationHostOnCommRx,
        SendCompanionAppConfigurationIntent,
        StartPairing,
        SendCompanionAppInstallIntent,
        SendPairingAnswer,
        ConfigurationHostOnWebSocketConnected,
        logger
    ) : null;

const mediaNotificationHost: MediaNotification.Host = new MediaNotification.Host(
    parseInt(Config.Get(mediaNotificationInterfacePortConfigKey)),
    MediaNotificationHostOnCommRx,
    (deviceIndex, error) => { SystemVars.Write("MediaError" + deviceIndex, error?.ErrorMessage ?? ''); },
    setDeviceMediaMetadataVariables,
    setDeviceMediaPlaybackVariables,
    logger
);

interface Device {
    controlConnection: ControlConnection,
    index: number,
    ipAddress: string,
    mediaDuration: number,
    mediaIsPlaying: boolean,
    mediaPosition: number,
    name: string,
    pairingConnection: PairingConnection | null,
    sendKeyState: {
        lastKeyTime: number | null,
        lastKey: number | null
    },
    serverCertConnection: ServerCertConnection | null,
    useCompanionApp: boolean,
    state: () => string
}

const devices: Array<Device> = new Array<Device>();

const controlConnectionHttpTimeoutTimerGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const controlConnectionPingTimeoutTimerGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const controlConnectionReconnectTimerGlobalHandlerMap : GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const controlConnectionSocketGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const pairingConnectionHttpTimerTimeoutMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const pairingConnectionHttpGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const serverCertConnectionSocketGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();
const serverCertConnectionSocketTimeoutTimerGlobalHandlerMap: GlobalHandlerMap<Device> = new GlobalHandlerMap<Device>();

for (let i = 1; i <= deviceCount; i++) {
    let ipAddress = Config.Get(ipAddressConfigKeyPrefix + i);
    let name = Config.Get(nameConfigKeyPrefix + i);
    let useCompanionApp = Config.Get(useCompanionAppConfigKeyPrefix + i) == "true";

    const device: Device = {
        controlConnection: new ControlConnection(
            ipAddress,
            controlPort,
            privateKeyPem,
            certificatePem,
            ControlConnectionOnCommRx,
            ControlConnectionOnConnect,
            ControlConnectionOnDisconnect,
            ControlConnectionOnHttpTimeout,
            ControlConnectionOnPingTimeout,
            ControlConnectionOnReconnect,
            ControlConnectionOnSSLHandshakeFailed,
            ControlConnectionOnSSLHandshakeOK,
            () => {
                setDeviceStateVariables(device);
                configurationHost?.sendState(devices);

                if (device.controlConnection.state == ControlConnectionState.Configured && device.useCompanionApp) {
                    device.controlConnection.sendIntentInternal(COMPANION_APP_SCHEME + '://' + COMPANION_APP_HOST + '/sync', COMPANION_APP_PACKAGE_NAME);
                }
            },
            logger
        ),
        index: i,
        ipAddress: ipAddress,
        mediaDuration: 0,
        mediaIsPlaying: false,
        mediaPosition: 0,
        name: name,
        pairingConnection: null,
        sendKeyState: {
            lastKey: null,
            lastKeyTime: null
        },
        serverCertConnection: null,
        useCompanionApp: useCompanionApp,
        state: () => (this.pairingConnection?.state ? PairingState[this.pairingConnection?.state] : null) ?? ControlConnectionState[this.controlConnection.state]
    };

    controlConnectionHttpTimeoutTimerGlobalHandlerMap.register(device.controlConnection.httpTimoutTimerHandle, device);
    controlConnectionPingTimeoutTimerGlobalHandlerMap.register(device.controlConnection.pingTimeoutTimerHandle, device);
    controlConnectionReconnectTimerGlobalHandlerMap.register(device.controlConnection.reconnectTimerHandle, device);
    controlConnectionSocketGlobalHandlerMap.register(device.controlConnection.httpHandle, device);

    setDeviceStateVariables(device);
    configurationHost?.sendState(devices);

    devices[i] = device;
}

let sendKeyCurrentTime = 0;
const sendKeyTimer = new Timer();
sendKeyTimer.Start(OnSendKeyTimer, sendKeyTimerInterval);

const mediaPositionTimer = new Timer();
mediaPositionTimer.Start(OnUpdateMediaPosition, mediaPositionTimerInterval);

System.OnShutdownFunc = OnShutdown;

function setDeviceMediaMetadataVariables(deviceIndex: number, mediaState: MediaNotification.MediaStateChanged | null) {
    logger.logTrace('setDeviceMediaMetadataVariables, deviceIndex: [' + deviceIndex + '], mediaState: [' + JSON.stringify(mediaState) + ']');
    const device = devices[deviceIndex];
    const duration = mediaState?.Metadata?.Duration ?? 0;
    device.mediaDuration = duration;

    mediaNotificationHost.Port

    logger.logTrace('Duration is: [' + device.mediaDuration + ']');

    // Set albumArtUri and add cachebuster param if Uri is local
    if (mediaState?.Metadata?.AlbumArt && !mediaState?.Metadata?.AlbumArtUri) {
        const paddedIndex = ('00' + deviceIndex).slice(-2);
        mediaState.Metadata.AlbumArtUri = 'http://' + System.IPAddress + ':' + mediaNotificationHost.Port + '/coverart?deviceIndex=' + paddedIndex + '&cb=' + Date.now();
    }

    logger.logTrace('AlbumArtUri is: [' + mediaState?.Metadata?.AlbumArtUri + ']');

    SystemVars.Write("MediaAlbum" + deviceIndex, mediaState?.Metadata?.Album ?? '');
    SystemVars.Write("MediaApp" + deviceIndex, mediaState?.AppName ?? '');
    SystemVars.Write("MediaArtist" + deviceIndex, mediaState?.Metadata?.Artist ?? '');
    SystemVars.Write("MediaCover" + deviceIndex, mediaState?.Metadata?.AlbumArtUri ?? '', 'IMGURL');
    SystemVars.Write("MediaDuration" + deviceIndex, msToTime(duration));
    SystemVars.Write("MediaPackage" + deviceIndex, mediaState?.PackageName ?? '');
    SystemVars.Write("MediaTitle" + deviceIndex, mediaState?.Metadata?.Title ?? '');
}

function setDeviceMediaPlaybackVariables(deviceIndex: number, playbackState: MediaNotification.PlaybackStateChanged | null) {
    logger.logTrace('setDeviceMediaPlaybackVariables');
    const device = devices[deviceIndex];
    device.mediaIsPlaying = (playbackState?.PlaybackState?.State == MediaNotification.State.STATE_PLAYING);
    device.mediaPosition = (playbackState?.PlaybackState?.Position ?? 0);

    SystemVars.Write("MediaPlaybackState" + deviceIndex, playbackState?.PlaybackState?.State ?? 0);
    SystemVars.Write("MediaElapsed" + deviceIndex, msToTime(device.mediaPosition));
    SystemVars.Write("MediaProgress" + deviceIndex, getProgress(device.mediaPosition, device.mediaDuration));
}

function setDeviceStateVariables(device: Device) {
    logger.logTrace('setDeviceStateVariables');
    const isConnected = (device.controlConnection.state == ControlConnectionState.Configured);
    SystemVars.Write("Connected" + device.index, isConnected);
    SystemVars.Write("Disconnected" + device.index, !isConnected);

    const isPairing = (device.pairingConnection != null);
    SystemVars.Write("Pairing" + device.index, isPairing);
    SystemVars.Write("NotPairing" + device.index, !isPairing);
    SystemVars.Write("PairingState" + device.index, isPairing ? device.pairingConnection!.state : 0);
}

// Function declarations for callbacks.
function OnUpdateMediaPosition() {
    mediaPositionTimer.Start(OnUpdateMediaPosition, mediaPositionTimerInterval);

    for (let i = 1; i <= deviceCount; i++) {
        const device = devices[i];
        if (!device.mediaIsPlaying) { continue; } // Do not update position if device is not playing
        
        const incrementedPosition = device.mediaPosition + mediaPositionTimerInterval;
        device.mediaPosition = (device.mediaDuration < 1) ? incrementedPosition : Math.min(device.mediaDuration, incrementedPosition);
        SystemVars.Write("MediaElapsed" + i, msToTime(device.mediaPosition));
        SystemVars.Write("MediaProgress" + i, getProgress(device.mediaPosition, device.mediaDuration));
    }
}

function OnSendKeyTimer() {
    sendKeyCurrentTime += sendKeyTimerInterval;
    sendKeyTimer.Start(OnSendKeyTimer, sendKeyTimerInterval);

    for (let i = 1; i <= deviceCount; i++) {
        let device = devices[i];

        if (device.sendKeyState.lastKey &&
            device.sendKeyState.lastKeyTime &&
            (sendKeyCurrentTime - device.sendKeyState.lastKeyTime) > sendKeyTimeout
        ) {
            device.controlConnection.sendKey(device.sendKeyState.lastKey, KeyAction.Up);
            logger.logTrace("SendKey timeout: key (" + device.sendKeyState.lastKey + "), device(" + i + ")");

            device.sendKeyState.lastKey = null;
            device.sendKeyState.lastKeyTime = null;
        }
    }
}

//#region ConfigurationHost event handlers
function ConfigurationHostOnCommRx(channel: number, data: string, handle: number) {
    logger.logTrace("ConfigurationHostOnCommRx, channel: " + channel);
    configurationHost!.onCommRx(channel, data, handle);
}

function ConfigurationHostOnWebSocketConnected() {
    logger.logTrace("ConfigurationHostOnWebSocketConnected");
    configurationHost!.sendState(devices);
}
//#endregion

//#region ControlConnection event handlers
function ControlConnectionOnCommRx(data: string, handle: number) {
    const device = controlConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnCommRx: Error retrieving device from handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnCommRx, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onCommRx(data); // encoding should be 'binary'
}

function ControlConnectionOnConnect(handle: number) {
    const device = controlConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnConnect: Error retrieving device from handle: " + handle);
        return;
    }
    
    logger.logTrace("ControlConnectionOnConnect, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onConnect();
}

function ControlConnectionOnDisconnect(handle: number) {
    const device = controlConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnDisconnect: Error retrieving device from handle: " + handle);
        return;
    }
    
    logger.logTrace("ControlConnectionOnDisconnect, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onDisconnect();
}

function ControlConnectionOnHttpTimeout(handle: number) {
    const device = controlConnectionHttpTimeoutTimerGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnHttpTimeout: Error retrieving device from handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnHttpTimeout, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onHttpTimeout();
}

function ControlConnectionOnPingTimeout(handle: number) {
    const device = controlConnectionPingTimeoutTimerGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnPingTimeout: Error retrieving device from handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnPingTimeout, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onPingTimeout();
}

function ControlConnectionOnReconnect(handle: number) {
    const device = controlConnectionReconnectTimerGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnReconnect: Error retrieving device from handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnReconnect, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onReconnect();
}

function ControlConnectionOnSSLHandshakeFailed(handle: number) {
    const device = controlConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnSSLHandshakeFailed: Error retrieving device from handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnSSLHandshakeFailed, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onSslHandshakeFailed();
}

function ControlConnectionOnSSLHandshakeOK(handle: number) {
    const device = controlConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ControlConnectionOnSSLHandshakeOK: Error retrieving device from  handle: " + handle);
        return;
    }

    logger.logTrace("ControlConnectionOnSSLHandshakeOK, handle: " + handle + ", device: " + device.index);
    device.controlConnection.onSSLHandshakeOK();
}
//#endregion

//#region MediaNotificationHost even handlers
function MediaNotificationHostOnCommRx(channel: number, data: string, handle: number) {
    mediaNotificationHost.onCommRx(channel, data, handle);
}
//#endregion

//#region PairingConnection event handlers
function PairingConnectionOnCommRx(data: string, handle: number) {
    const device = pairingConnectionHttpGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnCommRx: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnCommRx: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnCommRx, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onCommRx(data); // encoding should be 'binary'
}

function PairingConnectionOnConnect(handle: number) {
    const device = pairingConnectionHttpGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnConnect: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnConnect: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnConnect, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onConnect();
}

function PairingConnectionOnDisconnect(handle: number) {
    const device = pairingConnectionHttpGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnDisconnect: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnDisconnect: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnDisconnect, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onDisconnect();
}

function PairingConnectionOnHttpTimeout(handle: number) {
    const device = pairingConnectionHttpTimerTimeoutMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnHttpTimeout: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnHttpTimeout: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnHttpTimeout, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onHttpTimeout();
}

function PairingConnectionOnSSLHandshakeFailed(handle: number) {
    const device = pairingConnectionHttpGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnSSLHandshakeFailed: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnSSLHandshakeFailed: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnSSLHandshakeFailed, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onSSLHandshakeFailed();
}

function PairingConnectionOnSSLHandshakeOK(handle: number) {
    const device = pairingConnectionHttpGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("PairingConnectionOnSSLHandshakeOK: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.pairingConnection) {
        logger.logError("PairingConnectionOnSSLHandshakeOK: Error retrieving pairingConnection for device: " + device.index);
        return;
    }

    logger.logTrace("PairingConnectionOnSSLHandshakeOK, handle: " + handle + ", device: " + device.index);
    device.pairingConnection!.onSSLHandshakeOK();
}
//#endregion

//#region ServerCertConnection event handler
function ServerCertConnectionOnCommRx(data: string, handle: number) {
    const device = serverCertConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ServerCertConnectionOnCommRx: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.serverCertConnection) {
        logger.logError("ServerCertConnectionOnCommRx: Error retrieving serverCertConnection for device: " + device.index);
        return;
    }

    logger.logTrace("ServerCertConnectionOnCommRx, handle: " + handle + ", device: " + device.index);
    device.serverCertConnection!.onCommRx(data);
}

function ServerCertConnectionOnConnect(handle: number) {
    const device = serverCertConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ServerCertConnectionOnConnect: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.serverCertConnection) {
        logger.logError("ServerCertConnectionOnConnect: Error retrieving serverCertConnection for device: " + device.index);
        return;
    }

    logger.logTrace("ServerCertConnectionOnConnect, handle: " + handle + ", device: " + device.index);
    device.serverCertConnection!.onConnect();
}

function ServerCertConnectionOnDisconnect(handle: number) {
    const device = serverCertConnectionSocketGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ServerCertConnectionOnDisconnect: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.serverCertConnection) {
        logger.logError("ServerCertConnectionOnDisconnect: Error retrieving serverCertConnection for device: " + device.index);
        return;
    }

    logger.logTrace("ServerCertConnectionOnDisconnect, handle: " + handle + ", device: " + device.index);
    device.serverCertConnection!.onDisconnect();

    // TODO: migrate mapping cleanup to serverCertConnection.onStateChanged
    serverCertConnectionSocketGlobalHandlerMap.remove(device.serverCertConnection!.socketHandle);
    serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.remove(device.serverCertConnection!.socketTimeoutTimerHandler);
    device.serverCertConnection = null;
}

function ServerCertConnectionOnSocketTimeout(handle: number) {
    const device = serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.getMappedValueFromHandle(handle);
    if (!device) {
        logger.logError("ServerCertConnectionOnSocketTimeout: Error retrieving device from handle: " + handle);
        return;
    }
    if (!device.serverCertConnection) {
        logger.logError("ServerCertConnectionOnSocketTimeout: Error retrieving serverCertConnection for device: " + device.index);
        return;
    }

    logger.logTrace("ServerCertConnectionOnSocketTimeout, handle: " + handle + ", device: " + device.index);
    device.serverCertConnection!.onSocketTimeout();
    
    // TODO: migrate mapping cleanup to serverCertConnection.onStateChanged
    serverCertConnectionSocketGlobalHandlerMap.remove(device.serverCertConnection!.socketHandle);
    serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.remove(device.serverCertConnection!.socketTimeoutTimerHandler);
    device.serverCertConnection = null;
}
//#endregion

function OnShutdown() {
    logger.logTrace("OnShutdown");

    sendKeyTimer.Stop();
}

//#region System Functions
function SendKey(key: number, deviceIndex: number) {
    logger.logTrace("SendKey: key (" + key + "), device(" + deviceIndex + ")");

    const device = devices[deviceIndex];
    if (!device) {
        logger.logError("SendKey: Error retrieving device: " + deviceIndex);
    }

    if (!device.sendKeyState) {
        logger.logTrace("SendKey state not found for device: " + device.index);
        return;
    }

    if (!device.sendKeyState.lastKey) {
        device.controlConnection.sendKey(key, KeyAction.Down);
        logger.logTrace("Key down sent for key: " + key + " and device: " + device.index);
    }
    else if (device.sendKeyState.lastKey != key) {
        device.controlConnection.sendKey(device.sendKeyState.lastKey, KeyAction.Up);
        logger.logTrace("Key up sent for key: " + device.sendKeyState.lastKey + " and device: " + device.index);

        device.controlConnection.sendKey(key, KeyAction.Down);
        logger.logTrace("Key down sent for key: " + key + " and device: " + device.index);
    }

    device.sendKeyState.lastKey = key;
    device.sendKeyState.lastKeyTime = sendKeyCurrentTime;
}

function SendIntent(intentUri: string, deviceIndex: number) {
    logger.logTrace("SendIntent: intentUri (" + intentUri + "), device (" + deviceIndex + ")");

    const device = devices[deviceIndex];
    if (!device) {
        logger.logError("SendIntent: Error retrieving device: " + deviceIndex);
    }

    device.controlConnection.sendIntent(intentUri);

    logger.logTrace("Intent message sent");
}

function SendPairingAnswer(deviceIndex: number, answer: string) {
    logger.logTrace("SendPairingAnswer: device (" + deviceIndex + ")");

    const device = devices[deviceIndex];
    if (!device) {
        logger.logError("SendPairingAnswer: Error retrieving device: " + deviceIndex);
    }
    if (!device.pairingConnection) {
        logger.logError("SendPairingAnswer: Error retrieving pairingConnection for device: " + deviceIndex);
    }
    if (answer.length != 4 && answer.length != 6) {
        logger.logError("SendPairingAnswer: Pairing answer [" + answer + "] needs to be four chanracters or six characters for device: " + deviceIndex);
    }

    device.pairingConnection!.sendAnswer(answer);
}

function SendCompanionAppConfigurationIntent(deviceIndex: number) {
    logger.logTrace("SendCompanionAppConfigurationIntent: device (" + deviceIndex + ")");
    
    const device = devices[deviceIndex];

    device.controlConnection.sendIntentInternal(COMPANION_APP_SCHEME + '://' + COMPANION_APP_HOST + '/config?deviceindex=' + deviceIndex + '&hostip=' + System.IPAddress + '&hostport=' + mediaNotificationHost.Port.toString(), COMPANION_APP_PACKAGE_NAME);
}

function SendCompanionAppInstallIntent(deviceIndex: number) {
    logger.logTrace("SendCompanionAppInstallIntent: device (" + deviceIndex + ")");

    const device = devices[deviceIndex];

    device.controlConnection.sendIntentInternal('market://details?id=' + COMPANION_APP_PACKAGE_NAME, COMPANION_APP_PACKAGE_NAME);
}

function StartPairing(deviceIndex: number) {
    logger.logTrace("StartPairing: device(" + deviceIndex + ")");

    const device = devices[deviceIndex];
    if (!device) {
        logger.logError("StartPairing: Error retrieving device: " + deviceIndex);
    }

    device.serverCertConnection = new ServerCertConnection(
        device.ipAddress,
        pairingPort,
        (serverCert) => { // Initialize PairingConnection after server cert retrieved
            device.pairingConnection = new PairingConnection(
                device.ipAddress,
                pairingPort,
                privateKeyPem!,
                certificatePem!,
                serverCert,
                PairingConnectionOnCommRx,
                PairingConnectionOnConnect,
                PairingConnectionOnDisconnect,
                PairingConnectionOnHttpTimeout,
                PairingConnectionOnSSLHandshakeFailed,
                PairingConnectionOnSSLHandshakeOK,
                () => {
                    setDeviceStateVariables(device);
                    configurationHost?.sendState(devices);

                    switch (device.pairingConnection!.state) {
                        case PairingState.Successful:
                            device.controlConnection.reconnect();
                            
                            // Unregister PairingConnection handles
                            pairingConnectionHttpTimerTimeoutMap.remove(device.pairingConnection!.httpTimeoutTimerHandle);
                            pairingConnectionHttpGlobalHandlerMap.remove(device.pairingConnection!.httpHandle);
                            device.pairingConnection = null;
                            break;
        
                        case PairingState.Failed:
                            // Unregister PairingConnection handles
                            pairingConnectionHttpTimerTimeoutMap.remove(device.pairingConnection!.httpTimeoutTimerHandle);
                            pairingConnectionHttpGlobalHandlerMap.remove(device.pairingConnection!.httpHandle);
                            device.pairingConnection = null;
                            break;
        
                        default:
                            break;
                    }
                },
                logger);
        
            // Register PairingConnection handles
            pairingConnectionHttpTimerTimeoutMap.register(device.pairingConnection.httpTimeoutTimerHandle, device);
            pairingConnectionHttpGlobalHandlerMap.register(device.pairingConnection.httpHandle, device);
            logger.logTrace('pairingConnectionHttpTimerTimeoutMap item count: [' + pairingConnectionHttpTimerTimeoutMap.count + ']');
            logger.logTrace('pairingConnectionHttpGlobalHandlerMap item count: [' + pairingConnectionHttpGlobalHandlerMap.count + ']');

            // Unregister ServerCertConnection handles
            serverCertConnectionSocketGlobalHandlerMap.remove(device.serverCertConnection!.socketHandle);
            serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.remove(device.serverCertConnection!.socketTimeoutTimerHandler);
            device.serverCertConnection = null;        
        
            setDeviceStateVariables(device);
            configurationHost?.sendState(devices);
        },
        ServerCertConnectionOnCommRx,
        ServerCertConnectionOnConnect,
        ServerCertConnectionOnDisconnect,
        ServerCertConnectionOnSocketTimeout,
        logger
    );

    // Register ServerCertConnection handles
    serverCertConnectionSocketGlobalHandlerMap.register(device.serverCertConnection.socketHandle, device);
    serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.register(device.serverCertConnection.socketTimeoutTimerHandler, device);
    logger.logTrace('serverCertConnectionSocketGlobalHandlerMap item count: [' + serverCertConnectionSocketGlobalHandlerMap.count + ']');
    logger.logTrace('serverCertConnectionSocketTimeoutTimerGlobalHandlerMap item count: [' + serverCertConnectionSocketTimeoutTimerGlobalHandlerMap.count + ']');
}
//#endregion

function generateX509Certificate(publicKey: forge.pki.rsa.PublicKey, privateKey: forge.pki.rsa.PrivateKey): forge.pki.Certificate {
    logger.logTrace('Creating self-signed certificate...');
    var cert = forge.pki.createCertificate();
    cert.publicKey = publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    var attrs = [{
        name: 'commonName',
        value: 'noesislabs.com'
    }, {
        name: 'countryName',
        value: 'US'
    }, {
        shortName: 'ST',
        value: 'Minnesota'
    }, {
        name: 'localityName',
        value: 'Minneapolis'
    }, {
        name: 'organizationName',
        value: 'Noesis Labs LLC'
    }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'nsCertType',
        client: true,
        server: true,
        email: true,
        objsign: true,
        sslCA: true,
        emailCA: true,
        objCA: true
    }, {
        name: 'subjectKeyIdentifier'
    }]);

    // self-sign certificate
    cert.sign(privateKey, forge.md.sha256.create());

    return cert;
}

function getProgress(position: number, duration: number): number {
    let progress = 0;
    if (duration != 0) { 
        progress = Math.ceil((position / duration) * 100);
    }

    // logger.logTrace('getProgress, position: [' + position + '], duration: [' + duration + '], progress [' + progress + ']');

    return progress;
}

function logTraceLargeString(label:string, value: string) {
    let datadump = forge.util.createBuffer();
    datadump.putString(value);
    logger.logTrace('start ' + label + " data:");

    while (datadump.length() > 0) {
        const chunk = datadump.getBytes(100);
        logger.logTrace(chunk);
    }

    logger.logTrace('end ' + label + " data:");
}

function msToTime(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor((ms / 1000 / 3600) % 24);

    const time = [
        ('0' + hours.toString()).substr(-2),
        ('0' + minutes.toString()).substr(-2),
        ('0' + seconds.toString()).substr(-2)
    ].join(':');

    // logger.logTrace('msToTime, ms: [' + ms + '], time: [' + time + ']');

    return time;
}

function verifyCertificate(cert: forge.pki.Certificate) {
    logger.logTrace('Verifying Certificate');
    var caStore = forge.pki.createCaStore();
    caStore.addCertificate(cert);
    try {
        logger.logTrace("Verification Result: " + JSON.stringify(forge.pki.verifyCertificateChain(caStore, [cert])));
    } catch(ex) {
        logger.logTrace('Certificate verification failure: ' + JSON.stringify(ex));
    }
}
