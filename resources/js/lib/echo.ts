import Echo from "laravel-echo";
import Pusher from "pusher-js";

window.Pusher = Pusher;

const pusherKey = import.meta.env.VITE_PUSHER_APP_KEY;
const pusherCluster = import.meta.env.VITE_PUSHER_APP_CLUSTER;

if (!pusherKey) {
    throw new Error("Missing VITE_PUSHER_APP_KEY in environment variables.");
}

window.Echo = new Echo({
    broadcaster: "pusher",
    key: pusherKey,
    cluster: pusherCluster || "ap1",
    forceTLS: true,
});
