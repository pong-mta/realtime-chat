import Echo from "laravel-echo";
import Pusher from "pusher-js";

window.Pusher = Pusher;

const key = import.meta.env.VITE_PUSHER_APP_KEY;
const cluster = import.meta.env.VITE_PUSHER_APP_CLUSTER || "ap1";

if (!key) {
    throw new Error("Pusher app key is missing.");
}

window.Echo = new Echo({
    broadcaster: "pusher",
    key,
    cluster,
    forceTLS: true,
});

console.log("Pusher initialized:", cluster);
