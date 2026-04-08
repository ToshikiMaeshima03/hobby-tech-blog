---
title: "C++20コルーチンによるゲームAI実装の実践ガイド"
description: "C++20のco_await/co_yieldを活用してゲームAIのステートマシンや行動ツリーを実装する方法を解説。promise_typeの設計からパトロール・追跡AIの実装例まで網羅"
category: "game-dev"
tags: ["C++20", "コルーチン", "ゲームAI", "ステートマシン"]
publishedAt: 2026-04-08
featured: false
---

## C++20コルーチンがゲームAI開発を変える理由

ゲームAIの実装では、「パトロール中に敵を発見したら追跡に切り替え、距離が近づいたら攻撃する」といった逐次的な行動フローを記述する必要があります。従来のアプローチでは、これをステートマシンのswitch文や行動ツリーのノードクラスで表現してきました。

しかし、これらの手法にはコードが状態ごとに分断され、処理の流れが読みにくいという構造的な問題があります。状態が10個を超えると、遷移条件の管理だけで数百行のボイラープレートが発生します。

C++20で標準化されたコルーチンは、この問題に対するエレガントな解決策を提供します。`co_await`で実行を中断し、次のフレームで再開する。`co_yield`で現在の状態を返しつつ処理を一時停止する。これにより、AIの行動フローを上から下への自然な制御フローとして記述できます。

2026年現在、主要なコンパイラ（GCC 13+, Clang 17+, MSVC 19.30+）でC++20コルーチンは完全にサポートされており、UE5.3以降もC++20標準を公式にサポートしています。

## C++20コルーチンの基礎｜promise_typeとAwaitableの設計

### コルーチンの3つのキーワード

C++20コルーチンは、関数本体に以下のいずれかのキーワードが含まれると自動的にコルーチンとして認識されます。

- **co_await**: 式の結果を待機し、準備ができるまで実行を中断する
- **co_yield**: 値を呼び出し元に返しつつ、実行を中断する
- **co_return**: コルーチンを終了し、最終値を返す

通常の関数と異なり、コルーチンは中断時にスタックフレームをヒープに保存します。再開時にはそのフレームから実行を継続するため、ローカル変数の値が保持されます。

### ゲームAI用のTaskクラス設計

ゲームAIで使うコルーチンの戻り値型を設計します。`promise_type`はコルーチンのライフサイクルを制御するインターフェースです。

```cpp
#include <coroutine>
#include <optional>
#include <string>

// AIコルーチンの戻り値型
struct AITask {
    struct promise_type {
        std::optional<std::string> current_state;

        AITask get_return_object() {
            return AITask{
                std::coroutine_handle<promise_type>::from_promise(*this)
            };
        }

        // コルーチン開始時に即座に中断（遅延開始）
        std::suspend_always initial_suspend() noexcept { return {}; }

        // コルーチン終了時に中断（ハンドルの手動破棄が必要）
        std::suspend_always final_suspend() noexcept { return {}; }

        // co_yield で状態名を返す
        std::suspend_always yield_value(std::string state) {
            current_state = std::move(state);
            return {};
        }

        void return_void() {}
        void unhandled_exception() { std::terminate(); }
    };

    std::coroutine_handle<promise_type> handle;

    // ムーブのみ許可
    AITask(std::coroutine_handle<promise_type> h) : handle(h) {}
    AITask(AITask&& other) noexcept : handle(other.handle) { other.handle = nullptr; }
    ~AITask() { if (handle) handle.destroy(); }
    AITask(const AITask&) = delete;
    AITask& operator=(const AITask&) = delete;

    // 毎フレーム呼び出して1ステップ進める
    bool resume() {
        if (!handle || handle.done()) return false;
        handle.resume();
        return !handle.done();
    }

    // 現在の状態を取得
    std::optional<std::string> get_state() const {
        return handle.promise().current_state;
    }
};
```

ここで重要なのは`initial_suspend()`で`suspend_always`を返している点です。これによりコルーチンは遅延開始（lazy start）となり、最初の`resume()`呼び出しまで実行されません。ゲームループで毎フレーム`resume()`を呼ぶ設計と相性が良い選択です。

### WaitFrames Awaitable の実装

特定のフレーム数だけ待機するAwaitableを実装します。これがゲームAIコルーチンの基本的な待機プリミティブになります。

```cpp
// 指定フレーム数だけ待機するAwaitable
struct WaitFrames {
    int frames_remaining;

    explicit WaitFrames(int frames) : frames_remaining(frames) {}

    bool await_ready() const noexcept {
        return frames_remaining <= 0;  // 0以下なら待機不要
    }

    void await_suspend(std::coroutine_handle<> handle) noexcept {
        // 中断時の処理（ここではフレームカウントのみ）
    }

    void await_resume() noexcept {
        // 再開時の処理
    }
};

// 条件が真になるまで待機するAwaitable
struct WaitUntil {
    std::function<bool()> condition;

    explicit WaitUntil(std::function<bool()> cond) : condition(std::move(cond)) {}

    bool await_ready() const noexcept {
        return condition();
    }

    void await_suspend(std::coroutine_handle<> handle) noexcept {}
    void await_resume() noexcept {}
};
```

`await_ready()`が`true`を返すとコルーチンは中断せずに続行します。`false`を返すと`await_suspend()`が呼ばれて中断し、次の`resume()`で`await_resume()`から再開します。

## コルーチンによるゲームAIステートマシンの実装

### パトロール・追跡・攻撃AIの実装例

従来のswitch文ベースのステートマシンでは、状態遷移のたびに文脈が失われ、ローカル変数をメンバ変数に昇格させる必要がありました。コルーチンではこの問題が自然に解決されます。

```cpp
#include <cmath>
#include <vector>
#include <iostream>

struct Vector2 {
    float x, y;
    float distance_to(const Vector2& other) const {
        float dx = x - other.x;
        float dy = y - other.y;
        return std::sqrt(dx * dx + dy * dy);
    }
};

struct Enemy {
    Vector2 position;
    float detection_range = 10.0f;
    float attack_range = 2.0f;
    float move_speed = 0.1f;
    int health = 100;
};

struct Player {
    Vector2 position;
};

// ゲームワールドの参照（簡易版）
struct GameWorld {
    Player player;
    bool is_player_visible(const Vector2& from, float range) const {
        return from.distance_to(player.position) < range;
    }
};

// パトロール → 追跡 → 攻撃 のAIコルーチン
AITask enemy_ai_behavior(Enemy& enemy, const GameWorld& world,
                          const std::vector<Vector2>& patrol_points) {
    int patrol_index = 0;

    while (enemy.health > 0) {
        // === パトロール状態 ===
        co_yield "patrol";

        Vector2 target = patrol_points[patrol_index];
        while (enemy.position.distance_to(target) > 0.5f) {
            // プレイヤー発見チェック
            if (world.is_player_visible(enemy.position, enemy.detection_range)) {
                goto chase;  // 追跡に遷移
            }

            // パトロールポイントに向かって移動
            float dx = target.x - enemy.position.x;
            float dy = target.y - enemy.position.y;
            float dist = std::sqrt(dx * dx + dy * dy);
            enemy.position.x += (dx / dist) * enemy.move_speed;
            enemy.position.y += (dy / dist) * enemy.move_speed;

            co_yield "patrol";  // 1フレーム待機
        }

        patrol_index = (patrol_index + 1) % patrol_points.size();
        continue;

    chase:
        // === 追跡状態 ===
        co_yield "chase";

        while (world.is_player_visible(enemy.position, enemy.detection_range * 1.5f)) {
            float dist = enemy.position.distance_to(world.player.position);

            if (dist < enemy.attack_range) {
                goto attack;  // 攻撃に遷移
            }

            // プレイヤーに向かって移動（追跡速度は1.5倍）
            float dx = world.player.position.x - enemy.position.x;
            float dy = world.player.position.y - enemy.position.y;
            enemy.position.x += (dx / dist) * enemy.move_speed * 1.5f;
            enemy.position.y += (dy / dist) * enemy.move_speed * 1.5f;

            co_yield "chase";
        }

        // プレイヤーを見失った → パトロールに戻る
        continue;

    attack:
        // === 攻撃状態 ===
        co_yield "attack";

        std::cout << "Enemy attacks player!" << std::endl;

        // 攻撃後のクールダウン（30フレーム待機）
        for (int i = 0; i < 30; ++i) {
            co_yield "cooldown";
        }

        // 攻撃後、プレイヤーがまだ範囲内なら追跡に戻る
        if (world.is_player_visible(enemy.position, enemy.detection_range)) {
            goto chase;
        }
    }

    co_yield "dead";
}
```

このコードの特筆すべき点は、パトロールのインデックスやクールダウンカウンターがローカル変数として自然に保持されることです。従来のステートマシンでは、これらをクラスのメンバ変数として管理する必要がありました。

### ゲームループとの統合

```cpp
int main() {
    Enemy enemy{{0.0f, 0.0f}};
    GameWorld world{{{15.0f, 15.0f}}};
    std::vector<Vector2> patrol_points = {{0, 0}, {10, 0}, {10, 10}, {0, 10}};

    AITask ai = enemy_ai_behavior(enemy, world, patrol_points);

    // ゲームループ
    for (int frame = 0; frame < 1000; ++frame) {
        if (!ai.resume()) {
            std::cout << "AI behavior completed" << std::endl;
            break;
        }

        auto state = ai.get_state();
        if (state) {
            std::cout << "Frame " << frame
                      << " | State: " << *state
                      << " | Pos: (" << enemy.position.x
                      << ", " << enemy.position.y << ")" << std::endl;
        }
    }
    return 0;
}
```

毎フレーム`ai.resume()`を1回呼ぶだけで、AIの行動が1ステップ進みます。複数の敵がいる場合は、各敵のAITaskをベクターに格納して順番にresumeすれば良いだけです。

## co_yieldを活用した行動ツリー風の設計

### Sequenceノードとselectorノードのコルーチン実装

行動ツリーの基本的なコンポジットノードをコルーチンで表現できます。

```cpp
// 行動の結果を表す列挙型
enum class BehaviorStatus {
    Success,
    Failure,
    Running
};

// 行動ツリー用のコルーチン戻り値型
struct BehaviorTask {
    struct promise_type {
        BehaviorStatus status = BehaviorStatus::Running;

        BehaviorTask get_return_object() {
            return BehaviorTask{
                std::coroutine_handle<promise_type>::from_promise(*this)
            };
        }

        std::suspend_always initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }

        std::suspend_always yield_value(BehaviorStatus s) {
            status = s;
            return {};
        }

        void return_void() { status = BehaviorStatus::Success; }
        void unhandled_exception() { std::terminate(); }
    };

    std::coroutine_handle<promise_type> handle;

    BehaviorTask(std::coroutine_handle<promise_type> h) : handle(h) {}
    ~BehaviorTask() { if (handle) handle.destroy(); }
    BehaviorTask(BehaviorTask&& o) noexcept : handle(o.handle) { o.handle = nullptr; }
    BehaviorTask(const BehaviorTask&) = delete;
    BehaviorTask& operator=(const BehaviorTask&) = delete;

    bool tick() {
        if (!handle || handle.done()) return false;
        handle.resume();
        return !handle.done();
    }

    BehaviorStatus status() const {
        return handle.promise().status;
    }
};

// Sequence: 子タスクを順番に実行、全て成功で成功
BehaviorTask sequence(std::vector<std::function<BehaviorTask()>> children) {
    for (auto& child_factory : children) {
        BehaviorTask child = child_factory();
        while (child.tick()) {
            if (child.status() == BehaviorStatus::Failure) {
                co_yield BehaviorStatus::Failure;
                co_return;
            }
            co_yield BehaviorStatus::Running;
        }
    }
    co_yield BehaviorStatus::Success;
}

// 具体的な行動ノード例: 目標地点まで移動
BehaviorTask move_to(Enemy& enemy, Vector2 target) {
    while (enemy.position.distance_to(target) > 0.5f) {
        float dx = target.x - enemy.position.x;
        float dy = target.y - enemy.position.y;
        float dist = std::sqrt(dx * dx + dy * dy);
        enemy.position.x += (dx / dist) * enemy.move_speed;
        enemy.position.y += (dy / dist) * enemy.move_speed;
        co_yield BehaviorStatus::Running;
    }
    co_yield BehaviorStatus::Success;
}
```

行動ツリーの各ノードがコルーチンになることで、複数フレームにわたる行動を自然な制御フローで記述できます。`move_to`は目標地点に到達するまで毎フレーム`Running`を返し、到達したら`Success`を返します。

## コルーチンFSMライブラリの活用｜CoFSMパターン

C++20コルーチンによる有限状態マシンの実装パターンとして、CoFSM（Coroutine Finite State Machine）が注目されています。各状態をコルーチンとして表現し、`co_await`でイベントを受信する設計です。

```cpp
// CoFSMパターンの簡易実装
template<typename Event>
struct FSM {
    struct EventAwaiter {
        FSM& fsm;
        bool await_ready() const noexcept { return fsm.has_pending_event(); }
        void await_suspend(std::coroutine_handle<> h) noexcept {
            fsm.waiting_handle = h;
        }
        Event await_resume() noexcept {
            return fsm.consume_event();
        }
    };

    std::coroutine_handle<> waiting_handle = nullptr;
    std::optional<Event> pending_event;

    EventAwaiter get_event() { return EventAwaiter{*this}; }

    void send_event(Event e) {
        pending_event = std::move(e);
        if (waiting_handle) {
            auto h = waiting_handle;
            waiting_handle = nullptr;
            h.resume();
        }
    }

    bool has_pending_event() const { return pending_event.has_value(); }
    Event consume_event() {
        Event e = std::move(*pending_event);
        pending_event.reset();
        return e;
    }
};
```

このパターンでは、各状態が`co_await fsm.get_event()`でイベントを待ち、受信したイベントに応じて次の状態に遷移します。対称転送（symmetric transfer）を使えば、状態間の遷移時にスタックオーバーフローを防げます。

## パフォーマンスと注意点

### ヒープアロケーション

コルーチンのフレーム（ローカル変数を含む）はデフォルトでヒープに確保されます。大量のAIエージェントがいる場合、カスタムアロケータの使用を検討してください。

```cpp
struct AITask {
    struct promise_type {
        // カスタムアロケータでヒープ確保を最適化
        void* operator new(std::size_t size) {
            return ai_memory_pool.allocate(size);
        }
        void operator delete(void* ptr) {
            ai_memory_pool.deallocate(ptr);
        }
        // ... 他のメンバは同じ
    };
};
```

### HALO最適化

コンパイラはコルーチンのライフタイムが呼び出し元のスコープ内で完結する場合、ヒープアロケーションを省略できます（Heap Allocation eLision Optimization）。ただし、これはコンパイラの最適化に依存するため、パフォーマンスクリティカルな場面では計測が必要です。

### コンパイラ対応状況（2026年現在）

| コンパイラ | バージョン | 対応状況 |
|-----------|-----------|---------|
| GCC | 13+ | 完全対応 |
| Clang | 17+ | 完全対応 |
| MSVC | 19.30+ | 完全対応 |
| UE5 | 5.3+ | C++20標準サポート |

## まとめ

- C++20コルーチンの`co_await`と`co_yield`を使うと、AIの逐次的な行動フローを自然な制御構造で記述できる
- `promise_type`と`AITask`クラスの設計が基盤となり、ゲームループの`resume()`呼び出しで毎フレーム1ステップ進行する
- パトロール・追跡・攻撃といった状態遷移がローカル変数を保持したまま記述でき、従来のステートマシンより可読性が高い
- 行動ツリーの各ノードもコルーチンで表現可能で、Sequence/Selectorパターンと組み合わせられる
- ヒープアロケーションのコストに注意し、大量エージェントではカスタムアロケータやメモリプールの使用を検討する
- 2026年現在、主要コンパイラとUE5で完全サポートされており、プロダクション利用の準備は整っている
