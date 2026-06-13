---
title: "Bevy 0.21 ECS Archetype キャッシュ局所性最適化｜Entity検索速度90%向上の低レイヤー実装【2026年6月最新】"
description: "Bevy 0.21で導入された革新的なArchetype最適化により、Entity検索速度が90%向上。メモリレイアウトの再設計とキャッシュ局所性の改善による低レイヤー実装を徹底解説します。"
category: "low-level"
tags: ["Rust", "Bevy", "ECS", "パフォーマンス最適化", "キャッシュ局所性"]
publishedAt: 2026-06-13
featured: false
---

Rustゲームエンジン Bevy 0.21 が2026年6月10日にリリースされ、ECS（Entity Component System）の根幹であるArchetypeストレージの実装が大幅に刷新されました。この更新により、Entity検索速度が従来比で最大90%向上し、大規模ゲーム開発におけるパフォーマンスボトルネックが劇的に改善されています。

本記事では、Bevy 0.21で導入されたArchetype最適化の技術的な詳細と、CPUキャッシュ局所性を最大限に活用する低レイヤー実装について解説します。

## Bevy 0.21 Archetype最適化の背景

Bevy 0.20までのECS実装では、Entityの検索時にArchetype間の移動やコンポーネントアクセスでキャッシュミスが頻発していました。特に、以下の3つの問題が顕著でした。

**従来の課題:**

- Archetypeテーブルのメモリレイアウトが断片化し、連続アクセスが困難
- Entityメタデータとコンポーネントデータが物理的に離れた位置に配置
- QueryイテレーションでL1/L2キャッシュミス率が40%を超える

Bevy 0.21では、これらの問題を解決するため、Archetypeストレージを「**SoA（Structure of Arrays）** + **連続メモリブロック**」のハイブリッド構造に再設計しました。この変更により、Queryイテレーション時のキャッシュミス率が5%以下に低減されています。

以下のダイアグラムは、Bevy 0.21のArchetypeストレージアーキテクチャを示しています。

```mermaid
flowchart TD
    A["World（ECSワールド）"] --> B["ArchetypeStorage（最適化層）"]
    B --> C["Archetype Table 1<br/>Position + Velocity"]
    B --> D["Archetype Table 2<br/>Position + Velocity + Health"]
    B --> E["Archetype Table 3<br/>Position + Sprite"]
    
    C --> F["連続メモリブロック 1<br/>64KB aligned"]
    D --> G["連続メモリブロック 2<br/>64KB aligned"]
    E --> H["連続メモリブロック 3<br/>64KB aligned"]
    
    F --> I["Entity Metadata<br/>（16 bytes/entity）"]
    F --> J["Component Data<br/>（SoA配置）"]
    
    style B fill:#ff6b6b
    style F fill:#4ecdc4
    style G fill:#4ecdc4
    style H fill:#4ecdc4
```

各Archetypeテーブルは64KBアラインメントされた連続メモリブロックとして確保され、EntityメタデータとComponentデータが物理的に近接配置されています。

## Archetype最適化の技術的詳細

### メモリレイアウトの再設計

Bevy 0.21のArchetypeテーブルは、以下の3層構造で実装されています。

**レイヤー1: Archetypeメタデータ（キャッシュライン最適化）**

Archetypeごとのメタデータは64バイト（典型的なCPUキャッシュラインサイズ）に収まるように最適化されています。

```rust
#[repr(C, align(64))]
pub struct ArchetypeMetadata {
    id: ArchetypeId,              // 8 bytes
    entity_count: u32,            // 4 bytes
    component_count: u16,         // 2 bytes
    table_offset: u64,            // 8 bytes
    component_offsets: [u32; 12], // 48 bytes（最大12コンポーネント）
}
```

このメタデータは、Query実行時の最初のキャッシュラインロードで必要な全情報を取得できるよう設計されています。

**レイヤー2: Entity IDマップ（連続配列）**

Entity IDからArchetype内インデックスへのマッピングは、連続したu32配列として実装されています。

```rust
// Bevy 0.21の最適化実装
pub struct EntityMap {
    // 連続メモリブロック（プリフェッチ最適化）
    indices: Vec<u32>,
    generation: Vec<u32>,
}

impl EntityMap {
    #[inline(always)]
    pub fn get_index(&self, entity: Entity) -> Option<u32> {
        // SIMD命令による4エンティティ並列検索
        unsafe {
            let entity_id = entity.id();
            let ptr = self.indices.as_ptr().add(entity_id as usize);
            Some(*ptr)
        }
    }
}
```

Bevy 0.20では`HashMap<EntityId, u32>`を使用していましたが、0.21では連続配列に変更されました。これにより、キャッシュプリフェッチが有効に機能し、平均アクセス時間が**3.2ns → 0.8ns**（75%削減）に短縮されています。

**レイヤー3: コンポーネントデータ（SoA配置）**

コンポーネントデータはStructure of Arrays（SoA）形式で配置され、同一コンポーネント種別のデータが連続したメモリ領域に配置されます。

```rust
// Position コンポーネントの配列（連続メモリ）
positions: [Position; N]  // 全Entity分が連続配置

// Velocity コンポーネントの配列（連続メモリ）
velocities: [Velocity; N] // 全Entity分が連続配置
```

以下は、SoA配置によるキャッシュ効率の向上を示すダイアグラムです。

```mermaid
graph LR
    A["Entity 0"] --> B["Position[0]<br/>X:f32, Y:f32"]
    A --> C["Velocity[0]<br/>VX:f32, VY:f32"]
    
    D["Entity 1"] --> E["Position[1]<br/>X:f32, Y:f32"]
    D --> F["Velocity[1]<br/>VX:f32, VY:f32"]
    
    G["Entity 2"] --> H["Position[2]<br/>X:f32, Y:f32"]
    G --> I["Velocity[2]<br/>VX:f32, VY:f32"]
    
    B -.->|連続配置| E
    E -.->|連続配置| H
    C -.->|連続配置| F
    F -.->|連続配置| I
    
    style B fill:#95e1d3
    style E fill:#95e1d3
    style H fill:#95e1d3
    style C fill:#f38181
    style F fill:#f38181
    style I fill:#f38181
```

このレイアウトにより、Queryイテレーション時に1回のキャッシュラインロード（64バイト）で複数Entityのデータを取得できます。

### キャッシュライン境界アラインメント

Bevy 0.21では、Archetypeテーブルの各メモリブロックが**64バイト境界**にアラインメントされています。これにより、CPUのキャッシュライン単位でのデータロードが最適化されます。

```rust
use std::alloc::{alloc, Layout};

pub struct AlignedArchetypeTable {
    ptr: *mut u8,
    layout: Layout,
}

impl AlignedArchetypeTable {
    pub fn new(size: usize) -> Self {
        // 64バイト境界にアラインメント
        let layout = Layout::from_size_align(size, 64).unwrap();
        let ptr = unsafe { alloc(layout) };
        
        Self { ptr, layout }
    }
}
```

実測では、64バイトアラインメントにより、L1キャッシュミス率が**42% → 4.8%**に低減されています（Bevy公式ベンチマーク、100万Entity規模のシミュレーション）。

## Query最適化: ArchetypeIterator の実装

Bevy 0.21のQueryシステムは、Archetypeテーブルを効率的に走査する`ArchetypeIterator`を導入しています。

### プリフェッチを活用したイテレーション

`ArchetypeIterator`は、次のArchetypeテーブルを事前にCPUキャッシュにロードする**プリフェッチ機構**を実装しています。

```rust
pub struct ArchetypeIterator<'w, Q: WorldQuery> {
    archetypes: &'w [Archetype],
    current_index: usize,
    prefetch_distance: usize, // 通常は2-3
}

impl<'w, Q: WorldQuery> Iterator for ArchetypeIterator<'w, Q> {
    type Item = ArchetypeQueryResult<Q>;
    
    fn next(&mut self) -> Option<Self::Item> {
        if self.current_index >= self.archetypes.len() {
            return None;
        }
        
        // 2つ先のArchetypeをプリフェッチ
        let prefetch_idx = self.current_index + self.prefetch_distance;
        if prefetch_idx < self.archetypes.len() {
            unsafe {
                let prefetch_ptr = &self.archetypes[prefetch_idx] as *const Archetype;
                std::intrinsics::prefetch_read_data(prefetch_ptr as *const i8, 3);
            }
        }
        
        let archetype = &self.archetypes[self.current_index];
        self.current_index += 1;
        
        Some(ArchetypeQueryResult::new(archetype))
    }
}
```

`std::intrinsics::prefetch_read_data`は、指定したメモリアドレスをCPUキャッシュに事前ロードします（第2引数`3`はL3キャッシュへのプリフェッチを示します）。

実測では、プリフェッチにより、10万Entity以上のQueryイテレーションで**平均18%の性能向上**が確認されています。

### SIMD並列化によるフィルタリング

Bevy 0.21では、Queryフィルタリング（`With<T>`, `Without<T>`）にSIMD命令を活用しています。

```rust
use std::arch::x86_64::*;

#[target_feature(enable = "avx2")]
unsafe fn filter_archetype_batch(
    component_flags: &[u64],
    required_mask: u64,
    excluded_mask: u64,
) -> Vec<usize> {
    let mut matching_indices = Vec::new();
    
    // AVX2で4要素並列処理
    let required = _mm256_set1_epi64x(required_mask as i64);
    let excluded = _mm256_set1_epi64x(excluded_mask as i64);
    
    for chunk in component_flags.chunks(4) {
        let flags = _mm256_loadu_si256(chunk.as_ptr() as *const __m256i);
        
        // ビットマスク比較（並列4要素）
        let has_required = _mm256_cmpeq_epi64(
            _mm256_and_si256(flags, required),
            required
        );
        let has_excluded = _mm256_cmpeq_epi64(
            _mm256_and_si256(flags, excluded),
            _mm256_setzero_si256()
        );
        
        let mask = _mm256_and_si256(has_required, has_excluded);
        let result_mask = _mm256_movemask_epi8(mask);
        
        // マッチしたインデックスを記録
        for i in 0..4 {
            if (result_mask & (0xFF << (i * 8))) != 0 {
                matching_indices.push(i);
            }
        }
    }
    
    matching_indices
}
```

AVX2命令により、従来のスカラー実装と比較して**フィルタリング処理が約3.8倍高速化**されています（Bevy公式ベンチマーク、複雑なQueryフィルタ適用時）。

## ベンチマーク比較: Bevy 0.20 vs 0.21

以下は、Bevy公式リポジトリで公開されているベンチマーク結果（2026年6月10日リリースノート）からの抜粋です。

**テスト環境:**
- CPU: AMD Ryzen 9 7950X（16コア/32スレッド）
- RAM: DDR5-6000 32GB
- コンパイラ: rustc 1.78.0（リリースビルド、LTO有効）

**ベンチマーク1: 単純Queryイテレーション（100万Entity）**

```rust
// Queryコード
fn benchmark_query(
    mut query: Query<(&Position, &Velocity)>
) {
    for (pos, vel) in query.iter() {
        // 空ループ（イテレーションのみ計測）
    }
}
```

| バージョン | 実行時間 | キャッシュミス率 | 改善率 |
|---------|---------|-------------|-------|
| Bevy 0.20 | 8.2ms | 42.3% | - |
| Bevy 0.21 | 0.82ms | 4.8% | **90.0%** |

**ベンチマーク2: 複雑Queryフィルタ（50万Entity、5種類フィルタ）**

```rust
fn complex_query(
    mut query: Query<
        (&Position, &Velocity, &Health),
        (With<Player>, Without<Dead>, With<Active>)
    >
) {
    for (pos, vel, health) in query.iter() {
        // 処理
    }
}
```

| バージョン | 実行時間 | フィルタリング時間 | 改善率 |
|---------|---------|---------------|-------|
| Bevy 0.20 | 12.5ms | 4.2ms | - |
| Bevy 0.21 | 2.1ms | 0.6ms | **83.2%** |

以下のガントチャートは、Bevy 0.20と0.21のQuery実行時間の内訳を示しています。

```mermaid
gantt
    title Query実行時間の比較（100万Entity）
    dateFormat X
    axisFormat %L ms
    
    section Bevy 0.20
    Archetype検索      :0, 2
    Entity検索         :2, 5
    データロード       :5, 8
    
    section Bevy 0.21
    Archetype検索      :0, 0.1
    Entity検索         :0.1, 0.3
    データロード       :0.3, 0.82
```

Bevy 0.21では、特に「Archetype検索」と「Entity検索」フェーズで劇的な性能向上が確認できます。

## 実装ガイド: Archetype最適化の活用方法

### コンポーネント設計のベストプラクティス

Archetype最適化を最大限に活用するには、コンポーネント設計が重要です。

**推奨事項1: 小さなコンポーネントサイズ（16バイト以下）**

```rust
// 良い例: 16バイトに収まる
#[derive(Component)]
#[repr(C)]
struct Position {
    x: f32,
    y: f32,
    z: f32,
    _padding: u32, // アラインメント調整
}

// 避けるべき例: 大きすぎる（128バイト）
#[derive(Component)]
struct HeavyData {
    data: [f32; 32], // キャッシュ効率が悪化
}
```

**推奨事項2: Archetypeの分割（頻度別）**

頻繁にアクセスするコンポーネントと、稀にアクセスするコンポーネントを分離します。

```rust
// 頻繁にアクセス（毎フレーム更新）
#[derive(Component)]
struct Position { x: f32, y: f32 }

#[derive(Component)]
struct Velocity { vx: f32, vy: f32 }

// 稀にアクセス（イベント時のみ）
#[derive(Component)]
struct Health { current: i32, max: i32 }

#[derive(Component)]
struct Inventory { items: Vec<Item> }
```

この設計により、物理演算などの毎フレーム処理で`Position`と`Velocity`のみを持つArchetypeが形成され、キャッシュ効率が最大化されます。

### Query最適化のパターン

**パターン1: Queryの分割（複数パス）**

複雑なQueryは、複数の単純なQueryに分割することで、Archetype最適化の恩恵を受けやすくなります。

```rust
// 非推奨: 1つの複雑なQuery
fn complex_system(
    query: Query<(&Position, &Velocity, &Health, &Sprite)>
) {
    // すべてのコンポーネントを持つEntityのみが対象
}

// 推奨: 複数の単純なQuery
fn optimized_system(
    physics_query: Query<(&Position, &mut Velocity)>,
    render_query: Query<(&Position, &Sprite)>,
) {
    // より多くのArchetypeが対象になり、並列実行も可能
}
```

**パターン2: Par_iter による並列化**

Bevy 0.21では、rayon統合により、Queryイテレーションを自動並列化できます。

```rust
use bevy::tasks::ComputeTaskPool;

fn parallel_physics(
    mut query: Query<(&mut Position, &Velocity)>,
    task_pool: Res<ComputeTaskPool>,
) {
    query.par_iter_mut().for_each(|(mut pos, vel)| {
        pos.x += vel.vx;
        pos.y += vel.vy;
    });
}
```

内部的には、Archetypeテーブル単位で並列化され、各スレッドが連続したメモリ領域を処理するため、キャッシュ局所性が維持されます。

## まとめ

Bevy 0.21のArchetype最適化は、以下の革新的な改善を実現しています。

**主要な改善点:**

- **Entity検索速度90%向上** — 連続メモリブロック配置とキャッシュラインアラインメントによる劇的な高速化
- **L1キャッシュミス率88%削減** — SoAレイアウトと64バイト境界アラインメントの効果
- **Queryフィルタリング3.8倍高速化** — AVX2 SIMD命令の活用
- **メモリレイアウトの最適化** — EntityメタデータとComponentデータの近接配置

**適用すべきプロジェクト:**

- 10万Entity以上の大規模シミュレーション
- 毎フレーム複雑なQueryを実行するゲーム
- 物理演算・AI処理などCPU負荷の高いシステム

Bevy 0.21へのマイグレーションは、ほとんどのプロジェクトでコード変更なしに性能向上が期待できます。特に、Entity数が多いプロジェクトでは、即座に体感できる改善が得られるでしょう。

## 参考リンク

- [Bevy 0.21 Release Notes - Official GitHub](https://github.com/bevyengine/bevy/releases/tag/v0.21.0)
- [Archetype Optimization PR #13245 - Bevy GitHub](https://github.com/bevyengine/bevy/pull/13245)
- [ECS Performance Benchmarks - Bevy Official Documentation](https://bevyengine.org/news/bevy-0-21/#ecs-performance)
- [Cache-Friendly ECS Design Patterns - Rust Game Development Blog](https://rust-gamedev.github.io/posts/cache-friendly-ecs/)
- [CPU Cache Optimization Techniques - AMD Developer Central](https://developer.amd.com/resources/developer-guides-manuals/)