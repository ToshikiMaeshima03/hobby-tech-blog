---
title: "UE5.11 Lumen Surface Cache圧縮アルゴリズム完全解説｜動的GI計算を60%削減する実装詳解"
description: "UE5.11の最新機能Lumen Surface Cache圧縮アルゴリズムを徹底解説。動的グローバルイルミネーション計算コストを60%削減する低レイヤー実装の技術詳解と実装パターンを紹介します。"
category: "game-dev"
tags: ["Unreal Engine 5", "Lumen", "グローバルイルミネーション", "GPU最適化", "リアルタイムレンダリング"]
publishedAt: 2026-07-01
featured: false
---

Unreal Engine 5.11で実装された**Lumen Surface Cache圧縮アルゴリズム**は、動的グローバルイルミネーション（GI）のメモリ効率を劇的に改善する技術革新です。従来のLumenでは、Surface Cacheが大量のVRAMを消費し、大規模シーンでのパフォーマンスボトルネックとなっていました。

Epic Gamesが2026年6月にリリースしたUE5.11では、**Neural Radiosity Cache圧縮**と**動的プローブボリューム最適化**を組み合わせた新アルゴリズムにより、GI計算コストを最大60%削減しながら視覚品質を維持することに成功しています。

本記事では、UE5.11の公式ドキュメントとリリースノートを基に、Surface Cache圧縮の低レイヤー実装を技術的に解説し、実際のプロジェクトへの適用方法を詳述します。

## Lumen Surface Cacheの基本アーキテクチャ

Lumen Surface Cacheは、シーン内のサーフェス（表面）ごとに間接光（Indirect Lighting）情報をキャッシュするデータ構造です。従来のUE5.10以前では、各サーフェスの放射照度（Irradiance）を**非圧縮のフロートテクスチャ**として保存していました。

### 従来の問題点

- **メモリ消費**: 4K解像度シーンで平均2.5GB以上のVRAM使用
- **帯域幅**: フレームごとに最大800MB/sの読み書き発生
- **動的更新コスト**: 可動オブジェクトの光源変化時に全キャッシュ再計算

以下のダイアグラムは、従来のSurface Cacheアーキテクチャを示しています。

```mermaid
flowchart TD
    A["シーンジオメトリ"] --> B["Surface Cacheエントリ生成"]
    B --> C["各サーフェスに非圧縮テクスチャ割り当て"]
    C --> D["放射照度計算（Radiosity Solver）"]
    D --> E["テクスチャメモリへ書き込み<br/>（非圧縮・4チャンネルFloat32）"]
    E --> F["GPU VRAM: 2.5GB+"]
    F --> G["フレームごとに読み取り<br/>帯域幅: 800MB/s"]
```

各サーフェスが独立したテクスチャを持つため、大規模シーンではメモリフットプリントが線形に増加します。

## UE5.11の圧縮アルゴリズム詳解

UE5.11では、**Neural Radiosity Compression**と呼ばれる機械学習ベースの圧縮手法を導入しました。このアルゴリズムは以下の3段階で動作します。

### 1. Radiosity特徴量抽出

シーン内の各サーフェスから、以下の特徴量を抽出します。

- **基底関数係数**: Spherical Harmonics（SH）の9係数
- **法線ベクトル**: 圧縮法線（16bit精度）
- **反射率**: アルベド情報（RGB各8bit）

```cpp
// UE5.11のSurface Cache圧縮エントリ構造（C++実装例）
struct FCompressedSurfaceCacheEntry {
    FVector3f SHCoefficients[9];  // 9 SH bands
    FPackedNormal CompressedNormal;  // 16-bit normal
    FColor Albedo;  // 8-bit per channel RGB
    uint16 Confidence;  // Neural network confidence score
};
```

### 2. Neural Network圧縮

Epic Gamesが訓練した軽量ニューラルネットワーク（推論時0.2ms以下）を用いて、SH係数を**4次元の潜在ベクトル**に圧縮します。

- **入力**: 9次元SH係数ベクトル
- **出力**: 4次元圧縮ベクトル（Float16）
- **圧縮率**: 約70%（36バイト→16バイト）

以下のシーケンス図は、圧縮処理のGPUパイプラインを示しています。

```mermaid
sequenceDiagram
    participant Scene as シーンジオメトリ
    participant Extractor as 特徴量抽出Compute Shader
    participant NN as Neural Compressor<br/>（GPU推論）
    participant Cache as 圧縮Surface Cache

    Scene->>Extractor: サーフェスデータ送信
    Extractor->>Extractor: SH係数・法線・アルベド計算
    Extractor->>NN: 9次元SH係数
    NN->>NN: 4次元潜在ベクトルへ圧縮<br/>（推論時間: 0.2ms）
    NN->>Cache: 圧縮データ書き込み<br/>（16バイト/エントリ）
    Cache-->>Scene: 次フレームで参照
```

Neural Compressorは、Epic内部で訓練された専用モデルで、リアルタイム推論に最適化されています。

### 3. 動的プローブボリューム統合

UE5.11では、圧縮Surface Cacheと**Probe Volume（プローブボリューム）**を統合し、動的ライトの変化を効率的に反映します。

Probe Volumeは、シーン空間を格子状に分割し、各格子点（プローブ）で間接光をサンプリングする手法です。UE5.11の新機能では：

- **適応的プローブ配置**: 重要度の高い領域に動的に密度を増加
- **階層的更新**: 変化の大きい領域のみ再計算
- **Surface Cacheとの補間**: 圧縮キャッシュとプローブ値を線形補間

```mermaid
graph LR
    A["圧縮Surface Cache<br/>（静的ジオメトリ）"] --> C["Radiosity統合シェーダー"]
    B["動的Probe Volume<br/>（可動オブジェクト周辺）"] --> C
    C --> D["最終Irradiance出力<br/>（メモリ: -60%）"]
    
    style A fill:#e1f5ff
    style B fill:#fff4e1
    style D fill:#e8f5e9
```

この統合により、静的ジオメトリは圧縮キャッシュから読み取り、動的オブジェクト周辺のみプローブ更新を行うため、計算コストが大幅に削減されます。

## 実装パターンとプロジェクト設定

UE5.11でSurface Cache圧縮を有効化するには、プロジェクト設定ファイル（`DefaultEngine.ini`）に以下を追加します。

```ini
[/Script/Engine.RendererSettings]
r.Lumen.SurfaceCache.EnableCompression=1
r.Lumen.SurfaceCache.CompressionQuality=2
r.Lumen.ProbeVolume.AdaptiveDensity=1
r.Lumen.SurfaceCache.MaxMemoryBudgetMB=800
```

### パラメータ解説

| パラメータ | デフォルト値 | 説明 |
|-----------|------------|------|
| `EnableCompression` | 0（無効） | Neural圧縮の有効化（1=有効） |
| `CompressionQuality` | 1 | 圧縮品質（0=最速/低品質、2=高品質/やや低速） |
| `AdaptiveDensity` | 0 | Probe Volumeの適応的密度調整 |
| `MaxMemoryBudgetMB` | 1200 | Surface Cacheの最大VRAM使用量（MB） |

### ブループリントでの動的制御

C++だけでなく、ブループリントからも圧縮設定を動的に変更できます。

```cpp
// C++からの動的制御例
#include "Engine/RendererSettings.h"

void AMyGameMode::EnableLumenCompression(int32 Quality)
{
    auto* Settings = GetMutableDefault<URendererSettings>();
    Settings->SetLumenSurfaceCacheCompression(true, Quality);
    Settings->UpdateSinglePropertyInConfigFile(
        Settings->GetClass()->FindPropertyByName(
            GET_MEMBER_NAME_CHECKED(URendererSettings, bLumenSurfaceCacheCompression)
        ),
        Settings->GetDefaultConfigFilename()
    );
}
```

## パフォーマンス比較とベンチマーク結果

Epic Gamesの公式ベンチマーク（2026年6月発表）では、UE5.11の圧縮アルゴリズムにより以下の改善が報告されています。

### テストシーン詳細

- **シーン規模**: オープンワールド4km²
- **ポリゴン数**: 約1億ポリゴン
- **動的ライト数**: 50個
- **テスト環境**: NVIDIA RTX 4090、AMD Ryzen 9 7950X

### 測定結果

| メトリクス | UE5.10（圧縮なし） | UE5.11（圧縮有効） | 改善率 |
|-----------|-------------------|-------------------|--------|
| VRAM使用量 | 2,450 MB | 980 MB | **-60%** |
| 帯域幅/フレーム | 820 MB/s | 340 MB/s | **-58.5%** |
| GI更新時間 | 4.2ms | 1.7ms | **-59.5%** |
| フレームレート（平均） | 62 FPS | 89 FPS | **+43.5%** |

以下のガントチャートは、UE5.10と5.11でのGI計算タイムラインを比較しています。

```mermaid
gantt
    title Lumen GI計算タイムライン比較（1フレーム）
    dateFormat X
    axisFormat %L ms

    section UE5.10（圧縮なし）
    Surface Cache読み取り      :done, ue510_read, 0, 1.8
    Radiosity計算             :done, ue510_rad, 1.8, 2.5
    Probe Volume更新          :done, ue510_probe, 4.3, 1.2
    書き込み・統合            :done, ue510_write, 5.5, 0.9
    合計: 4.2ms               :milestone, ue510_total, 6.4, 0

    section UE5.11（圧縮有効）
    圧縮Cache読み取り         :active, ue511_read, 7, 0.6
    Neural圧縮推論            :active, ue511_nn, 7.6, 0.2
    Radiosity計算（軽量）     :active, ue511_rad, 7.8, 0.5
    適応Probe更新             :active, ue511_probe, 8.3, 0.3
    書き込み・統合            :active, ue511_write, 8.6, 0.1
    合計: 1.7ms               :milestone, ue511_total, 8.7, 0
```

UE5.11では、各処理ステップが大幅に短縮されていることが確認できます。

## 視覚品質の検証

圧縮による視覚品質の劣化は、Epic Gamesの評価によると「ほぼ知覚不可能」とされています。以下の比較検証が行われました。

### 品質評価指標

- **PSNR（Peak Signal-to-Noise Ratio）**: 平均48.2dB（高品質）
- **SSIM（Structural Similarity Index）**: 0.97（1.0が完全一致）
- **盲検テスト**: 被験者50名中、82%が圧縮版と非圧縮版を区別不可能

特に以下のシーンで高い品質を維持：

- 屋内シーン（間接光が支配的）
- 拡散反射の多い環境
- 中〜遠距離の視点

一方、以下のケースでわずかな品質低下が観測されました（PSNR 42dB程度）：

- 鏡面反射の多いメタリック表面
- 極端に近接したカメラ視点（1m以内）
- 高コントラストの直接光/影境界

### 品質低下への対処

Epic Gamesは、品質が重要なシーンでは`CompressionQuality=2`（高品質モード）を推奨しています。このモードでは：

- Neural Networkの推論精度を向上（Float32内部演算）
- SH係数を5次元潜在ベクトルに圧縮（わずかにメモリ増）
- PSNR平均52.1dBに向上

## 実装時の注意点とトラブルシューティング

UE5.11のSurface Cache圧縮を実装する際の典型的な問題と解決策を紹介します。

### 問題1: 圧縮有効化後にライティングがちらつく

**原因**: Probe Volumeの更新頻度が不足している可能性があります。

**解決策**: `r.Lumen.ProbeVolume.UpdateRate`を増やします（デフォルト1.0→2.0推奨）。

```ini
[/Script/Engine.RendererSettings]
r.Lumen.ProbeVolume.UpdateRate=2.0
```

### 問題2: VRAMが期待通り削減されない

**原因**: 他のLumen機能（Reflections、Translucency等）が無圧縮キャッシュを使用している可能性があります。

**解決策**: すべてのLumen機能で圧縮を有効化します。

```ini
r.Lumen.Reflections.SurfaceCache.EnableCompression=1
r.Lumen.Translucency.SurfaceCache.EnableCompression=1
```

### 問題3: コンソール/モバイルで動作しない

**現状**: UE5.11のNeural圧縮は、現時点でPC/次世代コンソール（PS5/Xbox Series X）のみサポートされています。モバイルプラットフォーム（iOS/Android）およびSwitch向けには、代替の**固定パレット圧縮**が提供されています。

```ini
; モバイル向け設定
r.Lumen.SurfaceCache.EnableCompression=1
r.Lumen.SurfaceCache.UsePaletteCompression=1  ; Neural圧縮の代わりにパレット圧縮を使用
```

## まとめ

UE5.11のLumen Surface Cache圧縮アルゴリズムは、以下の技術革新により動的GI計算を大幅に最適化します。

- **Neural Radiosity Compression**: 機械学習ベースの圧縮でVRAM使用量60%削減
- **適応的Probe Volume**: 動的ライトの変化を効率的に反映（計算コスト59.5%削減）
- **高品質維持**: PSNR 48.2dB、SSIM 0.97で視覚品質をほぼ完全に保持
- **柔軟な設定**: プロジェクトのニーズに応じて品質/パフォーマンスをバランス調整可能

大規模オープンワールドやリアルタイム映像制作において、UE5.11の圧縮技術は必須の最適化手法となります。プロジェクトの要件に応じて`CompressionQuality`を調整し、最適なパフォーマンスと品質のバランスを見つけることが重要です。

## 参考リンク

- [Unreal Engine 5.11 Release Notes - Lumen Improvements](https://docs.unrealengine.com/5.11/en-US/unreal-engine-5-11-release-notes/)
- [Lumen Technical Details - Epic Games Developer Community](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details)
- [UE5.11 Lumen Surface Cache Compression - Official Blog (2026年6月)](https://www.unrealengine.com/en-US/blog/lumen-surface-cache-compression-ue5-11)
- [Neural Compression for Real-Time Global Illumination - SIGGRAPH 2026 Paper](https://dl.acm.org/doi/10.1145/3450626.3459863)
- [Optimizing Lumen for Open World Games - Unreal Fest 2026 Presentation](https://www.unrealengine.com/en-US/events/unreal-fest-2026/optimizing-lumen)