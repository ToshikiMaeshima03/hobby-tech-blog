---
title: "Rust unsafe コードの安全性検証：miri による実行時メモリバグ検出ガイド"
description: "Rust の unsafe コードのメモリ安全性を miri で検証する方法を解説。未定義動作の検出から CI 統合まで、実践的なガイドを提供します。"
category: "low-level"
tags: ["Rust", "miri", "unsafe", "メモリ安全性", "未定義動作"]
publishedAt: 2026-04-08
featured: false
---

Rust は強力な型システムと所有権モデルによってメモリ安全性を保証しますが、`unsafe` ブロックを使うとその保証は開発者の責任になります。unsafe コードのバグは通常のテストでは発見しにくく、未定義動作（Undefined Behavior, UB）として潜在的な脆弱性やクラッシュの原因になります。

この記事では、Rust 公式の実行時検証ツール **miri** を使って unsafe コードのメモリバグを検出する方法を、実践的なコード例とともに解説します。miri は Rust の中間表現（MIR）レベルでプログラムをインタプリタ実行し、未定義動作を即座に検出できる強力なツールです。

## miri とは何か：Rust の未定義動作検出エンジン

miri（MIR Interpreter）は、Rust コンパイラが生成する中間表現（MIR）を直接実行するインタプリタです。通常の実行とは異なり、miri はメモリアクセス、ポインタ操作、並行処理の挙動を厳密に監視し、未定義動作を検出した瞬間にエラーを報告します。

### miri が検出できる主な未定義動作

- **メモリ安全性違反**：解放済みメモリへのアクセス（use-after-free）、境界外アクセス、無効なポインタデリファレンス
- **データ競合**：スレッド間での同期されていない共有メモリアクセス
- **アライメント違反**：型のアライメント要求を満たさないメモリアクセス
- **無効な値の生成**：bool や enum の無効なビットパターン、null でない参照への null 代入
- **不正な関数呼び出し**：関数ポインタの型不一致、存在しない関数の呼び出し

### miri のインストールと基本的な使い方

miri は rustup 経由でインストールできます。2026年4月現在、nightly ツールチェインが必要です。

```bash
# nightly ツールチェインをインストール
rustup toolchain install nightly

# miri コンポーネントを追加
rustup +nightly component add miri

# プロジェクトで miri を実行
cargo +nightly miri test
cargo +nightly miri run
```

miri は標準的な `cargo test` や `cargo run` の代わりに使用でき、既存のテストスイートをそのまま検証できます。

## unsafe コードの典型的なバグと miri による検出

実際のコード例を通じて、miri がどのように未定義動作を検出するか見ていきましょう。

### 例1：use-after-free の検出

```rust
use std::alloc::{alloc, dealloc, Layout};

fn main() {
    unsafe {
        let layout = Layout::from_size_align(8, 8).unwrap();
        let ptr = alloc(layout);
        
        // メモリを解放
        dealloc(ptr, layout);
        
        // 解放済みメモリへのアクセス（UB）
        *ptr = 42;
    }
}
```

通常の実行では動作してしまう場合もありますが、miri で実行すると即座にエラーが報告されます。

```bash
$ cargo +nightly miri run
error: Undefined Behavior: dereferencing pointer failed: 
alloc123 has been freed, so this pointer is dangling
```

miri はアロケーション ID（`alloc123`）単位でメモリを追跡し、解放済み領域へのアクセスを正確に検出します。

### 例2：境界外アクセスの検出

```rust
fn main() {
    let mut arr = [1, 2, 3, 4, 5];
    unsafe {
        let ptr = arr.as_mut_ptr();
        // 配列の境界外（6番目の要素）へのアクセス
        *ptr.add(5) = 100;
    }
}
```

miri の出力：

```bash
error: Undefined Behavior: out-of-bounds pointer arithmetic: 
alloc456 has size 20, so pointer at offset 20 is out-of-bounds
```

miri は各アロケーションのサイズを正確に追跡し、ポインタ演算が境界を超えた瞬間を検出します。

### 例3：データ競合の検出

```rust
use std::thread;
use std::sync::Arc;

fn main() {
    let data = Arc::new(std::cell::Cell::new(0));
    let data_clone = data.clone();
    
    let handle = thread::spawn(move || {
        // 非同期での値の書き込み
        data_clone.set(1);
    });
    
    // メインスレッドでの読み込み（データ競合）
    let _ = data.get();
    handle.join().unwrap();
}
```

miri は Rust のメモリモデルに基づいてデータ競合を検出します。

```bash
error: Undefined Behavior: Data race detected between 
Write on thread `<unnamed>` and Read on thread `main`
```

## miri の高度な使い方：フラグとカスタマイズ

miri は環境変数やフラグを通じて検出動作をカスタマイズできます。

### 主要な miri フラグ

```bash
# スタックトレースを詳細に表示
MIRIFLAGS="-Zmiri-backtrace=full" cargo +nightly miri test

# 分離されたアロケーション（メモリ安全性を厳格化）
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run

# 並行処理のスケジューリングをランダム化（データ競合を検出しやすくする）
MIRIFLAGS="-Zmiri-preemption-rate=0.01" cargo +nightly miri test

# 特定の警告を無効化（FFI など）
MIRIFLAGS="-Zmiri-disable-isolation" cargo +nightly miri run
```

### 実践例：FFI コードの検証

外部 C ライブラリを呼び出す場合、miri は通常エラーを出します。`-Zmiri-disable-isolation` を使うことで、一部の FFI 呼び出しを許可できます。

```rust
extern "C" {
    fn abs(input: i32) -> i32;
}

fn main() {
    unsafe {
        let result = abs(-42);
        println!("Result: {}", result);
    }
}
```

```bash
MIRIFLAGS="-Zmiri-disable-isolation" cargo +nightly miri run
```

ただし、C 側のメモリ安全性は miri では検証できないため、Rust 側の境界で適切なチェックを行う必要があります。

## miri を CI/CD パイプラインに統合する

miri をプロジェクトの継続的インテグレーションに組み込むことで、unsafe コードのリグレッションを防げます。

### GitHub Actions での miri 統合例

```yaml
name: Miri

on: [push, pull_request]

jobs:
  miri:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Rust nightly
        uses: dtolnay/rust-toolchain@nightly
        with:
          components: miri
      
      - name: Run Miri
        run: cargo miri test
        env:
          MIRIFLAGS: -Zmiri-symbolic-alignment-check
          RUST_BACKTRACE: 1
```

### miri テストの選択的実行

すべてのテストで miri を実行すると時間がかかるため、`#[cfg(miri)]` 属性を使って miri 専用のテストを分離できます。

```rust
#[test]
fn normal_test() {
    // 通常のテスト
}

#[test]
#[cfg(miri)]
fn miri_specific_test() {
    // unsafe コードの詳細な検証
    unsafe {
        let mut x = 42;
        let ptr = &mut x as *mut i32;
        *ptr = 100;
        assert_eq!(x, 100);
    }
}
```

```bash
# miri でのみ実行されるテストを含む
cargo +nightly miri test
```

## miri の限界と代替ツールとの使い分け

miri は強力ですが、すべてのケースをカバーできるわけではありません。

### miri の主な制約

- **パフォーマンス**：インタプリタ実行のため、通常の実行より10〜100倍遅い
- **環境依存コード**：ファイル I/O、ネットワーク、OS 固有 API は制限される
- **FFI の制約**：外部 C ライブラリの内部は検証できない
- **ハードウェア依存**：SIMD や特定の CPU 命令は部分的なサポート

### 他のツールとの組み合わせ

| ツール | 用途 | miri との使い分け |
|--------|------|------------------|
| **AddressSanitizer (ASan)** | ネイティブ実行でのメモリエラー検出 | 大規模プログラム、本番環境に近い検証 |
| **ThreadSanitizer (TSan)** | データ競合の検出 | 実際の並行実行環境でのテスト |
| **Valgrind** | メモリリーク、無効なアクセス検出 | 外部ライブラリを含む全体検証 |
| **Loom** | Rust 並行処理の決定論的テスト | 複雑な並行アルゴリズムの検証 |

実践的なワークフローとしては、開発中は miri で迅速に検証し、CI では miri + ASan の両方を実行することで、幅広いバグを捕捉できます。

```bash
# ASan での実行例
RUSTFLAGS="-Z sanitizer=address" cargo +nightly run
```

## まとめ：miri を使った安全な unsafe コードの実装戦略

- **miri は Rust の中間表現レベルで未定義動作を検出する実行時検証ツール**。use-after-free、境界外アクセス、データ競合などを即座に報告する
- **インストールは `rustup +nightly component add miri` で完了**。既存のテストスイートに `cargo +nightly miri test` で適用できる
- **MIRIFLAGS 環境変数で検出の厳格さを調整可能**。`-Zmiri-symbolic-alignment-check` や `-Zmiri-preemption-rate` で検出精度を高められる
- **CI/CD に統合することで unsafe コードのリグレッションを防止**。GitHub Actions などで自動検証を実装すべき
- **miri は万能ではない**。パフォーマンステストや外部ライブラリの検証には AddressSanitizer や Valgrind を併用する

unsafe コードは Rust の強力な機能ですが、その安全性は開発者の責任です。miri を開発ワークフローに組み込むことで、未定義動作を早期に発見し、堅牢な低レイヤコードを実装できます。2026年現在、miri は活発に開発が続いており、Rust の安全性保証を補完する不可欠なツールとなっています。