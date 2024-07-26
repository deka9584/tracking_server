const WebSocketServer = require("ws").Server;
const mqtt = require("mqtt");
const appSettings = require("./app-settings.json");

const port = appSettings.wssPort || 8000;
const wss = new WebSocketServer({ port });

const options = {
    // Clean session
    clean: true,
    connectTimeout: 4000,
    // Authentication
    clientId: 'tracking-mqtt',
}

const mqttClient = mqtt.connect(appSettings.mqttServer, options);
const registeredUsers = new Map();
const activeUsers = new Map();
const history = [];

mqttClient.on("error", (err) => {
    console.log(err);
});

mqttClient.on("connect", () => {
    mqttClient.subscribe("presence", (err) => {
        if (!err) {
            mqttClient.publish("presence", "Hello mqtt");
        }
    });

    mqttClient.subscribe("stat/#", (err) => {
        if (err) {
            console.log(err);
        }
    });
});

mqttClient.on("message", (topic, message) => {
    // message is Buffer
    const msgString = message.toString();

    const info = topic.split("/");
    const pos = info[1];
    const stat = info[2];

    if (pos === "REGISTRAZIONE") {
        if (stat === "tagIN") {
            sendRegistrationReq(msgString);
        }
        return;
    }

    switch (stat) {
        case "tagIN":
            tagIn(msgString, pos);
            break;
        case "tagOUT":
            tagOut(msgString);
            break;
        default:
            break;
    }
});

wss.on("connection", (wsClient) => {
    console.log("Nuovo client connesso");
    sendHistory(wsClient);

    wsClient.on("message", (event) => {
        const messageData = JSON.parse(event);

        if (messageData.type === "registration-response") {
            registerUser(messageData.userId, messageData.name);
        }
    });

    wsClient.on("error", (err) => {
        console.error(err);
    });
});

const tagIn = (userID, pos) => {
    const user = {
        id: userID,
        loggedIn: new Date().getTime(),
        pos,
    };

    activeUsers.set(userID, user);
}

const tagOut = (userID) => {
    const user = activeUsers.get(userID);

    if (!user) {
        console.warn(userID, "tagOut failed: user not found");
        return;
    }

    const currentMillis = new Date().getTime();
    const timeMillis = currentMillis - user.loggedIn;
    const date = new Date(timeMillis);
    date.setHours(0);

    if (date.getMinutes() > 0 || date.getSeconds() > 0) {
        const time = date.toLocaleTimeString("it-IT").split(":");
        historyLog(userID, user.pos, `${time[1]}:${time[2]}`);
    }

    activeUsers.delete(userID);
}

const historyLog = (userID, pos, time) => {
    const name = registeredUsers.get(userID);

    const posName = `${pos}`
        .replace("1", "Lights")
        .replace("2", "Earthquake")
        .replace("3", "Launch-it")
        .replace("4", "Noise-ball");

    history.push({
        user: userID,
        name,
        pos: posName,
        time,
    });
    
    console.log(`POSTAZIONE: ${posName}, USER: ${userID}, NICKNAME: ${name}, TEMPO: ${time}`);

    wss.clients.forEach(wsClient => {
        sendHistory(wsClient);
    });
}

const sendHistory = (wsClient) => {
    const json = JSON.stringify({ 
        type: "history-data",
        history,
    });

    wsClient.send(json);
}

const sendRegistrationReq = (userId) => {
    const json = JSON.stringify({
        type: "registration-request",
        userId,
    });

    wss.clients.forEach(wsClient => {
        wsClient.send(json);
    });

    console.log(userId, "Registration triggered");
}

const registerUser = (userId, name) => {
    if (userId && name) {
        registeredUsers.set(userId, name);
        console.log(userId, `Registered as ${name}`);
    }
}