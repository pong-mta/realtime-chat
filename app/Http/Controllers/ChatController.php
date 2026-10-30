<?php

namespace App\Http\Controllers;

use App\Events\MessageSent;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ChatController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();

        $contacts = User::query()
            ->whereKeyNot($user->id)
            ->orderBy('name')
            ->get(['id', 'name', 'email']);

        $conversations = Conversation::query()
            ->forUser($user->id)
            ->with(['participants:id,name,email'])
            ->withMax('messages', 'created_at')
            ->orderByDesc('messages_max_created_at')
            ->get()
            ->map(fn (Conversation $conversation) => [
                'id' => $conversation->id,
                'participants' => $conversation->participants
                    ->where('id', '!=', $user->id)->values(),
                'last_message_at' => $conversation->messages_max_created_at,
            ]);

        return Inertia::render('chat/index', [
            'contacts' => $contacts,
            'conversations' => $conversations,
            'currentUser' => $user->only('id', 'name', 'email'),
        ]);
    }

    public function start(Request $request, User $user): JsonResponse
    {
        abort_if(
            $request->user()->is($user),
            422,
            'You cannot start a conversation with yourself.'
        );

        $conversation = DB::transaction(function () use ($request, $user) {
            $currentId = (int) $request->user()->id;
            $otherId = (int) $user->id;

            $existing = Conversation::query()
                ->whereHas('participants', fn ($q) => $q->whereKey($currentId))
                ->whereHas('participants', fn ($q) => $q->whereKey($otherId))
                ->withCount('participants')
                ->get()
                ->first(fn ($c) => $c->participants_count === 2);

            if ($existing) {
                return $existing;
            }

            $conversation = Conversation::create();
            $conversation->participants()->attach([$currentId, $otherId]);

            return $conversation;
        });

        return response()->json([
            'conversation' => $conversation->load('participants:id,name,email'),
        ]);
    }

    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $this->authorizeParticipant($request, $conversation);

        $messages = $conversation->messages()
            ->with('sender:id,name,email')
            ->latest('id')
            ->limit(50)
            ->get()
            ->reverse()
            ->values();

        return response()->json(['messages' => $messages]);
    }

    public function send(Request $request, Conversation $conversation): JsonResponse
    {
        $this->authorizeParticipant($request, $conversation);

        $validated = $request->validate([
            'body' => ['nullable', 'string', 'max:5000'],
            'image' => [
                'nullable',
                'image',
                'mimes:jpg,jpeg,png,webp',
                'max:5120',
            ],
        ]);

        $body = trim($validated['body'] ?? '');

        if ($body === '' && !$request->hasFile('image')) {
            return response()->json([
                'message' => 'Please enter a message or select an image.',
            ], 422);
        }

        $imagePath = null;

        if ($request->hasFile('image')) {
            $imagePath = $request->file('image')->store(
                'chat-images',
                'public'
            );
        }

        $message = $conversation->messages()->create([
            'sender_id' => $request->user()->id,
            'body' => $body,
            'image_path' => $imagePath,
        ]);

        $message->load('sender:id,name,email');

        broadcast(new MessageSent($message))->toOthers();

        return response()->json(['message' => $message], 201);
    }

    private function authorizeParticipant(Request $request, Conversation $conversation): void
    {
        abort_unless(
            $conversation->hasParticipant((int) $request->user()->id),
            403,
            'You are not a participant in this conversation.'
        );
    }
}
