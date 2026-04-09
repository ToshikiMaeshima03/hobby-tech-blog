---
title: "Rust unsafe ポインタ演算の安全性パターン：所有権検証ツール活用完全ガイド"
description: "Rust unsafeコードでポインタ演算を安全に扱う実践パターン。Miri・MSAN・Address Sanitizerを使った所有権検証と、実務で使えるセーフティガードの実装方法を解説"
category: "low-level"
tags: ["Rust", "unsafe", "ポインタ演算", "メモリ安全性", "Miri"]
publishedAt: 2026-04-09
featured: false
---

Rustは所有権システムによってメモリ安全性を保証する言語として知られていますが、パフォーマンスが重要な場面やFFI連携では`unsafe`ブロック内でのポインタ演算が避けられません。しかし、`unsafe`を使った瞬間にコンパイラの安全性保証は失われ、未定義動作やメモリ破壊のリスクが発生します。

本記事では、ゲームエンジンやシステムプログラミングで実際に使われている「安全な`unsafe`パターン」と、Miri・MSAN・Address Sanitizerなどの所有権検証ツールを使った実践的なテスト手法を完全解説します。2026年時点での最新ツールとベストプラクティスを網羅し、実装レベルで即座に適用可能な知識を提供します。

## unsafe ポインタ演算が必要になる場面と安全性の課題

### ゲーム開発での典型的なユースケース

ゲームエンジンやリアルタイムシステムでは、以下の場面で`unsafe`なポインタ演算が頻繁に使われます：

- **ECSシステムのコンポーネント配列アクセス**: Bevy・hecs・specsなどのECSエンジンでは、型消去されたコンポーネントストレージに生ポインタでアクセスします
- **SIMDバッファ操作**: AVX-512やNEONを使った並列処理で、アライメント保証されたバッファを直接操作
- **C/C++ライブラリとのFFI**: Vulkan・DirectX・PhysXなどのAPIで、C言語のポインタを直接扱う
- **カスタムアロケータ**: ゲーム用のプールアロケータやスタックアロケータの実装

```rust
// ECSシステムでの典型的なunsafeパターン（簡略化）
pub struct ComponentStorage {
    data: NonNull<u8>,
    len: usize,
    capacity: usize,
    item_size: usize,
}

impl ComponentStorage {
    pub unsafe fn get_unchecked(&self, index: usize) -> *mut u8 {
        // 境界チェックをスキップして高速アクセス
        self.data.as_ptr().add(index * self.item_size)
    }
}
```

### unsafeコードで発生する典型的なバグ

所有権検証ツールを使わずに`unsafe`を書くと、以下のような未定義動作が発生します：

1. **Use-After-Free**: 解放済みメモリへのアクセス
2. **ダングリングポインタ**: ライフタイムを超えたポインタの参照
3. **境界外アクセス**: バッファの範囲外を読み書き
4. **データ競合**: 複数スレッドからの非同期アクセス
5. **アライメント違反**: 未アライメントアドレスへのキャスト

これらのバグは、ReleaseビルドとDebugビルドで挙動が変わったり、特定の入力でのみ発生したりするため、通常のテストでは検出困難です。

## Miriによる所有権検証：インタプリタレベルでの未定義動作検出

### Miriとは何か

Miri（MIR Interpreter）は、RustのMID-level IR（MIR）を実行しながら、未定義動作を検出するインタプリタです。2026年現在、Rust 1.84.0に対応し、以下の機能を持ちます：

- **Stacked Borrows**: 借用スタックを追跡し、所有権違反を検出
- **Tree Borrows**（実験的）: より精密な借用追跡モデル
- **データ競合検出**: `Send`/`Sync`の違反を検出
- **アライメント検証**: 未アライメントアクセスの検出

### Miriのセットアップと実行

```bash
# Miriのインストール（nightly必須）
rustup +nightly component add miri

# 基本的な実行
cargo +nightly miri test

# 詳細なログ出力
MIRIFLAGS="-Zmiri-track-raw-pointers" cargo +nightly miri test

# Tree Borrowsモデルを使用（より厳密）
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri test
```

### 実践例：境界外アクセスの検出

```rust
#[cfg(test)]
mod tests {
    use std::ptr;

    #[test]
    fn test_safe_pointer_arithmetic() {
        let data = vec![1u32, 2, 3, 4, 5];
        let ptr = data.as_ptr();
        
        unsafe {
            // 正常なアクセス
            assert_eq!(*ptr.add(2), 3);
            
            // 境界外アクセス（Miriで検出される）
            // let invalid = *ptr.add(10); // "pointer to 40 bytes starting at ... is out-of-bounds"
        }
    }

    #[test]
    fn test_use_after_free() {
        let ptr = {
            let data = vec![42u32];
            data.as_ptr()
        }; // dataがドロップされる
        
        unsafe {
            // Miriで検出: "dereferencing pointer failed: 0x... is a dangling pointer"
            // let value = *ptr;
        }
    }
}
```

### Miriの限界と対処法

Miriは強力ですが、以下の制約があります：

- **FFIコードは検証不可**: C言語のライブラリ呼び出しは追跡できない
- **実行速度が遅い**: インタプリタなので通常の10-100倍時間がかかる
- **非決定的な動作**: 並行処理の一部のケースは検出できない

対処法として、FFI部分は分離してモックでテストする、CIで定期的に実行する、などの運用が推奨されます。

## Address SanitizerとMemorySanitizerによる実行時検証

### Address Sanitizer（ASan）の活用

Address Sanitizerは、コンパイル時にメモリアクセスを監視するコードを挿入し、実行時に以下を検出します：

- Use-after-free
- Heap/Stack/Global buffer overflow
- Use-after-return
- Double-free

```bash
# AsanとMSanのインストール（Linux/macOS）
rustup component add rust-src

# Asanを有効にしてビルド
RUSTFLAGS="-Z sanitizer=address" cargo +nightly build --target x86_64-unknown-linux-gnu

# テスト実行
RUSTFLAGS="-Z sanitizer=address" cargo +nightly test --target x86_64-unknown-linux-gnu
```

### Memory Sanitizer（MSan）による初期化チェック

MSanは未初期化メモリの使用を検出します。特にFFIやカスタムアロケータで重要です：

```rust
use std::alloc::{alloc, dealloc, Layout};

#[test]
fn test_uninitialized_memory() {
    unsafe {
        let layout = Layout::from_size_align(4, 4).unwrap();
        let ptr = alloc(layout) as *mut u32;
        
        // 未初期化メモリの読み取り（MSanで検出）
        // let value = *ptr; // "use-of-uninitialized-value"
        
        // 正しい使用
        ptr.write(42);
        assert_eq!(*ptr, 42);
        
        dealloc(ptr as *mut u8, layout);
    }
}
```

```bash
# MSanを有効にしてテスト（Linux x86_64のみサポート）
RUSTFLAGS="-Z sanitizer=memory" cargo +nightly test --target x86_64-unknown-linux-gnu
```

### Sanitizer使用時の注意点

- **Releaseビルドとの動作差異**: Sanitizerは最適化を制限するため、通常ビルドで現れるバグを見逃す可能性
- **パフォーマンス低下**: 2-5倍のオーバーヘッド
- **プラットフォーム依存**: MSanはLinux x86_64のみ、WindowsではDrMemoryなど代替ツールが必要

## 安全なunsafeパターン：実装レベルでの防御策

### パターン1：不変条件の明示とアサーション

```rust
/// SAFETY契約を明示した安全なポインタラッパー
pub struct SafeSlice<T> {
    ptr: NonNull<T>,
    len: usize,
}

impl<T> SafeSlice<T> {
    /// # Safety
    /// - `ptr`は`len`個の有効な要素を指している必要がある
    /// - `ptr`はアライメントされている必要がある
    /// - ライフタイム`'a`の間、他のコードが`ptr`を変更してはならない
    pub unsafe fn from_raw_parts(ptr: *mut T, len: usize) -> Self {
        // 不変条件のアサーション
        assert!(!ptr.is_null(), "pointer must not be null");
        assert!(ptr as usize % std::mem::align_of::<T>() == 0, 
                "pointer must be aligned");
        
        Self {
            ptr: NonNull::new_unchecked(ptr),
            len,
        }
    }

    pub fn get(&self, index: usize) -> Option<&T> {
        if index < self.len {
            // SAFETY: インデックスチェック済み、不変条件により有効
            Some(unsafe { &*self.ptr.as_ptr().add(index) })
        } else {
            None
        }
    }

    pub unsafe fn get_unchecked(&self, index: usize) -> &T {
        debug_assert!(index < self.len, "index out of bounds");
        &*self.ptr.as_ptr().add(index)
    }
}
```

### パターン2：PhantomDataによるライフタイム追跡

```rust
use std::marker::PhantomData;

/// ライフタイムを追跡する安全なポインタ
pub struct BorrowedPtr<'a, T> {
    ptr: NonNull<T>,
    // コンパイラに'aを使っていることを伝える
    _marker: PhantomData<&'a T>,
}

impl<'a, T> BorrowedPtr<'a, T> {
    pub fn new(reference: &'a T) -> Self {
        Self {
            ptr: reference.into(),
            _marker: PhantomData,
        }
    }

    pub fn as_ref(&self) -> &'a T {
        // SAFETY: 'aのライフタイムが保証されている
        unsafe { self.ptr.as_ref() }
    }
}

#[test]
fn test_lifetime_safety() {
    let data = vec![1, 2, 3];
    let borrowed = BorrowedPtr::new(&data[0]);
    
    // コンパイルエラー: dataが先にドロップされる
    // drop(data);
    // let value = borrowed.as_ref();
    
    assert_eq!(*borrowed.as_ref(), 1);
}
```

### パターン3：型状態パターンによる状態管理

```rust
/// 型レベルで状態を区別するバッファ
pub struct Buffer<State> {
    ptr: NonNull<u8>,
    len: usize,
    _state: PhantomData<State>,
}

pub struct Uninitialized;
pub struct Initialized;

impl Buffer<Uninitialized> {
    pub fn new(len: usize) -> Self {
        unsafe {
            let layout = Layout::from_size_align_unchecked(len, 8);
            let ptr = alloc(layout);
            assert!(!ptr.is_null(), "allocation failed");
            
            Self {
                ptr: NonNull::new_unchecked(ptr),
                len,
                _state: PhantomData,
            }
        }
    }

    /// 初期化して状態遷移
    pub fn initialize(self, data: &[u8]) -> Buffer<Initialized> {
        assert_eq!(data.len(), self.len);
        unsafe {
            std::ptr::copy_nonoverlapping(
                data.as_ptr(),
                self.ptr.as_ptr(),
                self.len
            );
        }
        
        Buffer {
            ptr: self.ptr,
            len: self.len,
            _state: PhantomData,
        }
    }
}

impl Buffer<Initialized> {
    /// 初期化済みバッファのみアクセス可能
    pub fn as_slice(&self) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(self.ptr.as_ptr(), self.len)
        }
    }
}

impl<State> Drop for Buffer<State> {
    fn drop(&mut self) {
        unsafe {
            let layout = Layout::from_size_align_unchecked(self.len, 8);
            dealloc(self.ptr.as_ptr(), layout);
        }
    }
}
```

## CIパイプラインへの統合：継続的な安全性検証

### GitHub Actionsでのセットアップ

```yaml
# .github/workflows/safety-check.yml
name: Memory Safety Checks

on: [push, pull_request]

jobs:
  miri:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@nightly
        with:
          components: miri
      - name: Run Miri
        run: cargo miri test
        env:
          MIRIFLAGS: -Zmiri-tree-borrows

  sanitizers:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        sanitizer: [address, memory, thread]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@nightly
        with:
          components: rust-src
      - name: Run tests with ${{ matrix.sanitizer }} sanitizer
        run: |
          RUSTFLAGS="-Z sanitizer=${{ matrix.sanitizer }}" \
          cargo +nightly test --target x86_64-unknown-linux-gnu
        continue-on-error: ${{ matrix.sanitizer == 'memory' }}

  loom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install loom
        run: cargo install --locked loom
      - name: Run concurrency tests
        run: cargo test --features loom
```

### Loomによる並行処理の検証

Loomは、並行処理コードのすべての実行順序をシミュレートしてデータ競合を検出します：

```rust
#[cfg(loom)]
use loom::{sync::Arc, thread};

#[cfg(not(loom))]
use std::{sync::Arc, thread};

#[test]
#[cfg(loom)]
fn test_concurrent_access() {
    loom::model(|| {
        let data = Arc::new(AtomicUsize::new(0));
        
        let handles: Vec<_> = (0..2).map(|_| {
            let data = Arc::clone(&data);
            thread::spawn(move || {
                data.fetch_add(1, Ordering::SeqCst);
            })
        }).collect();

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(data.load(Ordering::SeqCst), 2);
    });
}
```

## 実践的な検証戦略：段階的アプローチ

### フェーズ1：開発時（ローカル）

```bash
# 高速フィードバック
cargo test                          # 基本テスト
cargo +nightly miri test critical   # 重要な部分のみMiri

# デバッグ用
RUSTFLAGS="-C overflow-checks=on -C debug-assertions=on" cargo test
```

### フェーズ2：プルリクエスト時（CI）

```bash
# 完全検証
cargo +nightly miri test                              # すべてのMiriチェック
RUSTFLAGS="-Z sanitizer=address" cargo +nightly test  # Asan
cargo clippy -- -W clippy::undocumented_unsafe_blocks # unsafeドキュメント強制
```

### フェーズ3：リリース前

```bash
# プロダクション環境シミュレート
cargo test --release
cargo bench  # ベンチマークでも検証
cargo fuzz run target_name -- -max_total_time=3600  # Fuzzing
```

### 検証結果の評価基準

以下のチェックリストをすべてクリアする：

- ✅ Miriがエラーなく通過
- ✅ ASan/MSanで未定義動作検出なし
- ✅ すべての`unsafe`ブロックに`SAFETY`コメント
- ✅ Loomで並行処理の正当性検証済み
- ✅ Fuzzingで1時間以上クラッシュなし
- ✅ Releaseビルドで動作確認済み

## まとめ：安全なunsafeコードのための統合戦略

本記事で解説した技術を統合することで、`unsafe`コードの安全性を大幅に向上できます：

- **Miri**: 所有権違反・未定義動作をインタプリタレベルで検出（開発時・CI）
- **Address/Memory Sanitizer**: 実行時のメモリ破壊を実バイナリで検出（CI・本番検証）
- **安全なパターン**: 不変条件の明示、ライフタイム追跡、型状態パターンで設計レベルで防御
- **Loom**: 並行処理のすべての実行順序を検証してデータ競合を排除
- **CI統合**: 自動化された継続的検証でリグレッション防止

2026年現在、Rustエコシステムはこれらのツールが成熟し、ゲームエンジンやシステムソフトウェアで実戦投入されています。`unsafe`は「危険なコード」ではなく、「責任を持って検証すべきコード」として扱うことで、C/C++では不可能だったレベルの安全性とパフォーマンスを両立できます。

高速な描画パイプライン、カスタムアロケータ、FFI連携などで`unsafe`が必要になったとき、本記事のパターンとツールを活用して、プロダクション品質の安全なコードを実現してください。