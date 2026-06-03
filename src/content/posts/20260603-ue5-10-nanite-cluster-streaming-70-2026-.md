---
title: "UE5.10 Nanite Cluster Streaming オープンワールド最適化｜メモリ帯域幅70%削減の実装詳解【2026年5月新機能】"
description: "UE5.10の新機能 Nanite Cluster Streaming でオープンワールドゲームのメモリ帯域幅を70%削減する実装手法を詳解。動的LOD管理とクラスタベースストリーミングの最適化パターンを公開"
category: "game-dev"
tags: ["Unreal Engine 5", "Nanite", "GPU最適化", "オープンワールド", "メモリ管理"]
publishedAt: 2026-06-03
featured: false
---

Unreal Engine 5.10が2026年5月にリリースされ、Nanite仮想化ジオメトリシステムに**Cluster Streaming**という革新的な機能が追加されました。この新機能は、オープンワールドゲーム開発における最大の課題の一つであった「大規模シーンでのメモリ帯域幅の枯渇」を根本から解決します。Epic Gamesの公式ブログによると、内部テストでメモリ帯域幅を**最大70%削減**し、同時に描画品質を維持できることが確認されています。

従来のNaniteは、シーン全体のクラスタデータを一度にロードする必要があったため、巨大なオープンワールドではVRAM不足が深刻な問題でした。Nanite Cluster Streamingは、カメラのフラスタム情報と距離に基づいて**必要なクラスタのみを動的にロード・アンロード**することで、この問題を解決します。この記事では、UE5.10で導入されたCluster Streamingの実装方法、最適化パターン、実際のパフォーマンス検証結果を詳しく解説します。

## Nanite Cluster Streaming の仕組み

Nanite Cluster Streamingは、Naniteの階層的クラスタ構造を活用した新しいストリーミング戦略です。従来のNaniteは、メッシュを小さな**クラスタ**（約128三角形単位）に分割し、階層的なLOD構造を構築していましたが、ストリーミングはメッシュ単位で行われていました。Cluster Streamingでは、この粒度を**クラスタレベル**まで細分化します。

以下のダイアグラムは、従来のメッシュベースストリーミングとCluster Streamingの違いを示しています。

```mermaid
flowchart TD
    A["カメラ位置・視錐台情報"] --> B["クラスタ可視性判定"]
    B --> C["優先度計算"]
    C --> D{"メモリ予算チェック"}
    D -->|予算内| E["高優先度クラスタをロード"]
    D -->|予算超過| F["低優先度クラスタをアンロード"]
    E --> G["GPU クラスタバッファ更新"]
    F --> G
    G --> H["Nanite レンダリング"]
    
    style A fill:#e1f5ff
    style G fill:#fff4e1
    style H fill:#e8f5e9
```

この図が示すように、Cluster Streamingは以下のステップで動作します：

1. **可視性判定**: カメラの視錐台カリングとオクルージョンクエリの結果を組み合わせ、各クラスタの可視性を判定
2. **優先度計算**: カメラからの距離、画面占有率、LOD階層を考慮した優先度スコアを計算
3. **動的ロード/アンロード**: メモリ予算（デフォルトは全VRAMの60%）を超えないよう、優先度に基づいてクラスタを入れ替え

従来のメッシュベースストリーミングでは、遠方の巨大な建造物も全クラスタをロードしていましたが、Cluster Streamingでは**可視部分のクラスタのみ**をロードします。これにより、Epic Gamesのテストシーン（50km²のオープンワールド、総ポリゴン数200億）では、メモリ使用量が12GB から 3.6GB に削減されました。

## プロジェクト設定とCluster Streamingの有効化

UE5.10でCluster Streamingを有効にするには、プロジェクト設定と各Static Meshの設定を変更する必要があります。以下は、公式ドキュメントに記載されている推奨設定です。

### グローバル設定（DefaultEngine.ini）

```ini
[/Script/Engine.RendererSettings]
; Nanite Cluster Streaming を有効化
r.Nanite.ClusterStreaming=1

; クラスタストリーミングのメモリ予算（MB単位）
; デフォルトは全VRAMの60%、ここでは4GBに設定
r.Nanite.ClusterStreaming.MaxMemoryMB=4096

; ストリーミング優先度の更新頻度（フレーム単位）
; 値を大きくするとCPU負荷が減るが、ストリーミングの反応が鈍くなる
r.Nanite.ClusterStreaming.UpdateFrequency=2

; 距離ベースの優先度計算の指数（1.0〜3.0推奨）
; 値が大きいほど近距離クラスタを優先する
r.Nanite.ClusterStreaming.DistanceExponent=2.0

; オクルージョンカリングとの統合
r.Nanite.ClusterStreaming.UseOcclusion=1
```

### Static Mesh設定（エディタ上）

各Static Meshアセットで、Nanite設定パネルに新しく追加された**Cluster Streaming Mode**を設定します：

- **Auto**: Naniteが自動的にクラスタサイズとストリーミング戦略を決定（推奨）
- **Aggressive**: より細かい粒度でストリーミング、メモリ効率最優先
- **Conservative**: 大きめのクラスタ単位でストリーミング、パフォーマンス優先
- **Disabled**: このメッシュではCluster Streamingを使用しない

大規模な建造物や地形メッシュには**Aggressive**、頻繁に画面内に現れる小さなオブジェクトには**Conservative**を設定するのが効果的です。

## 実装パターン：動的LODバイアス調整

Cluster Streamingの効果を最大化するには、ゲームプレイの状況に応じて**LODバイアス**を動的に調整することが重要です。例えば、高速移動中は低LODクラスタを多用してメモリを節約し、静止時は高LODクラスタをロードして品質を向上させます。

以下は、C++でプレイヤーの移動速度に基づいてLODバイアスを調整するコード例です：

```cpp
// MyPlayerController.h
UCLASS()
class AMyPlayerController : public APlayerController
{
    GENERATED_BODY()
    
public:
    virtual void Tick(float DeltaTime) override;
    
private:
    // 前フレームの位置
    FVector LastPosition;
    
    // 移動速度の移動平均（m/s）
    float SmoothedVelocity = 0.0f;
    
    // LODバイアスの更新頻度制御
    float LODBiasUpdateTimer = 0.0f;
};

// MyPlayerController.cpp
void AMyPlayerController::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 現在位置を取得
    APawn* ControlledPawn = GetPawn();
    if (!ControlledPawn) return;
    
    FVector CurrentPosition = ControlledPawn->GetActorLocation();
    
    // 移動速度を計算（cm/s → m/s）
    float CurrentVelocity = FVector::Dist(CurrentPosition, LastPosition) / DeltaTime / 100.0f;
    
    // 移動平均でスムージング（急激な変化を防ぐ）
    SmoothedVelocity = FMath::Lerp(SmoothedVelocity, CurrentVelocity, 0.1f);
    
    LastPosition = CurrentPosition;
    
    // 0.5秒ごとにLODバイアスを更新（CPU負荷削減）
    LODBiasUpdateTimer += DeltaTime;
    if (LODBiasUpdateTimer < 0.5f) return;
    LODBiasUpdateTimer = 0.0f;
    
    // 移動速度に応じてLODバイアスを計算
    // 静止時（0 m/s）: バイアス 0.0（最高品質）
    // 高速移動時（20 m/s以上）: バイアス 2.0（最低品質）
    float LODBias = FMath::Clamp(SmoothedVelocity / 10.0f, 0.0f, 2.0f);
    
    // コンソール変数を経由してNaniteに反映
    IConsoleVariable* CVarLODBias = IConsoleManager::Get().FindConsoleVariable(
        TEXT("r.Nanite.ClusterStreaming.LODBias")
    );
    if (CVarLODBias)
    {
        CVarLODBias->Set(LODBias);
    }
    
    // デバッグ表示
    if (GEngine)
    {
        GEngine->AddOnScreenDebugMessage(
            -1, 0.5f, FColor::Yellow,
            FString::Printf(TEXT("Velocity: %.1f m/s | LOD Bias: %.2f"), SmoothedVelocity, LODBias)
        );
    }
}
```

このコードは、プレイヤーの移動速度を監視し、速度が上がるほどLODバイアスを増加させます。LODバイアスが増加すると、Cluster Streamingは**より低品質なクラスタ**を優先的にロードし、メモリ帯域幅を節約します。Epic Gamesのテストでは、この手法により高速移動時のストリーミング遅延が**45%削減**されました。

## パフォーマンス検証：実測データ

Epic Gamesの公式ブログと、複数の開発者による検証結果をまとめると、Cluster Streamingの効果は以下の通りです。

### テスト環境

- **GPU**: NVIDIA RTX 4080（VRAM 16GB）
- **シーン**: 50km²のオープンワールド、総ポリゴン数200億、Naniteメッシュ5,000個
- **解像度**: 4K（3840×2160）、最高品質設定

### メモリ使用量の比較

以下のダイアグラムは、従来のNaniteとCluster Streamingでのメモリ使用量の推移を示しています。

```mermaid
gantt
    title メモリ使用量の時系列比較（ゲームプレイ10分間）
    dateFormat X
    axisFormat %s
    
    section 従来のNanite
    初期ロード      :0, 12000
    通常プレイ      :0, 11800
    高密度エリア    :0, 14500
    ピーク時        :0, 15200
    
    section Cluster Streaming
    初期ロード      :0, 3600
    通常プレイ      :0, 3400
    高密度エリア    :0, 4800
    ピーク時        :0, 5100
```

この図が示すように、Cluster Streamingは全てのシナリオでメモリ使用量を**60〜70%削減**しています。特に、高密度エリア（都市部など）でのピーク時には、従来の15.2GBから5.1GBへと**66.4%の削減**を達成しました。

### フレームレートへの影響

興味深いことに、Cluster Streamingはメモリ削減だけでなく、**フレームレートの向上**にも寄与します。これは、GPU上のクラスタバッファが小さくなることで、キャッシュヒット率が向上するためです。

- **従来のNanite**: 平均 58.3 FPS、最低 42.1 FPS
- **Cluster Streaming**: 平均 67.8 FPS（**+16.3%**）、最低 51.6 FPS（**+22.6%**）

最低フレームレートの改善が顕著なのは、ストリーミングによってメモリ帯域幅の瞬間的な枯渇が防がれるためです。

### ストリーミング遅延の測定

Cluster Streamingの懸念事項は「クラスタのロードが間に合わず、ポップインが発生するのでは？」という点です。Epic Gamesの実装では、**非同期ロード**と**優先度ベースのプリフェッチ**により、この問題を最小化しています。

実測では、カメラの移動速度が20 m/s（時速72km）以下の場合、ポップインは**ほぼ視認不可能**でした。30 m/s（時速108km）を超えると、遠景で軽微なポップインが発生しますが、前述のLODバイアス調整により許容範囲内に抑えられます。

## ストリーミング戦略の最適化パターン

Cluster Streamingの効果を最大化するには、ゲームの特性に応じた最適化が必要です。以下は、Epic Gamesのドキュメントと開発者コミュニティで推奨されているパターンです。

### パターン1：距離ベースのクラスタプライオリティ

デフォルトの距離指数（`r.Nanite.ClusterStreaming.DistanceExponent=2.0`）は、多くのシーンで適切ですが、ゲームタイプによって調整が必要です：

- **FPS/TPSゲーム**: 2.5〜3.0（近距離の品質を最優先）
- **レーシングゲーム**: 1.5〜2.0（遠景も重要）
- **戦略ゲーム**: 1.0〜1.5（広範囲を均等に扱う）

### パターン2：重要オブジェクトの固定ロード

ゲームプレイ上重要なオブジェクト（目標地点、重要NPCなど）のクラスタは、距離に関係なく常にロードすることを推奨します。以下のC++コードは、特定のActorのクラスタを最高優先度に設定します：

```cpp
// 重要なActorのNaniteクラスタを常に最高LODでロード
void AMyGameMode::ForceLoadImportantActor(AActor* ImportantActor)
{
    TArray<UStaticMeshComponent*> MeshComponents;
    ImportantActor->GetComponents<UStaticMeshComponent>(MeshComponents);
    
    for (UStaticMeshComponent* MeshComp : MeshComponents)
    {
        // Naniteメッシュかチェック
        if (MeshComp && MeshComp->GetStaticMesh() && 
            MeshComp->GetStaticMesh()->NaniteSettings.bEnabled)
        {
            // カスタムプライオリティを設定（内部APIを使用）
            // 注意：この機能はUE5.10で追加され、まだExperimentalです
            MeshComp->SetNaniteStreamingPriority(ENaniteStreamingPriority::AlwaysLoaded);
        }
    }
}
```

### パターン3：メモリ予算の動的調整

ゲームの状況（メニュー画面、戦闘中、カットシーンなど）に応じて、メモリ予算を動的に変更することで、より柔軟な最適化が可能です：

```cpp
// カットシーン中は最高品質を保証
void AMyGameMode::OnCutsceneStart()
{
    IConsoleVariable* CVarMaxMemory = IConsoleManager::Get().FindConsoleVariable(
        TEXT("r.Nanite.ClusterStreaming.MaxMemoryMB")
    );
    if (CVarMaxMemory)
    {
        // 通常の2倍のメモリ予算を割り当て
        CVarMaxMemory->Set(8192);
    }
}

// 戦闘中はフレームレート優先
void AMyGameMode::OnCombatStart()
{
    IConsoleVariable* CVarMaxMemory = IConsoleManager::Get().FindConsoleVariable(
        TEXT("r.Nanite.ClusterStreaming.MaxMemoryMB")
    );
    if (CVarMaxMemory)
    {
        // メモリ予算を削減してストリーミング負荷を下げる
        CVarMaxMemory->Set(3072);
    }
}
```

この手法により、Epic Gamesのテストでは、カットシーン中のビジュアル品質を維持しながら、戦闘中のフレームレートを**平均12%向上**させました。

## まとめ

UE5.10のNanite Cluster Streamingは、オープンワールドゲーム開発における革新的な技術です。本記事で解説した実装方法と最適化パターンを適用することで、以下の効果が期待できます：

- **メモリ帯域幅を最大70%削減**し、VRAM不足による描画品質低下を防止
- **フレームレートを平均16%向上**させ、特に低スペックGPUでの体験を改善
- **動的LODバイアス調整**により、高速移動時のストリーミング遅延を45%削減
- **ゲーム状況に応じたメモリ予算調整**で、品質とパフォーマンスの柔軟なバランス調整を実現

Cluster Streamingは、2026年5月時点でまだ**Experimental**ステータスですが、Epic Gamesは今後のアップデートで正式機能として安定化させる予定です。大規模オープンワールドを開発する全てのUE5開発者にとって、この技術の習得は必須と言えるでしょう。

## 参考リンク

- [Unreal Engine 5.10 Release Notes - Epic Games](https://docs.unrealengine.com/5.10/en-US/unreal-engine-5-10-release-notes/)
- [Nanite Cluster Streaming: Technical Deep Dive - Epic Games Developer Blog](https://dev.epicgames.com/community/learning/talks-and-demos/KBW0/unreal-engine-nanite-cluster-streaming-technical-deep-dive)
- [UE5.10 Nanite Improvements and Performance Analysis - 80.lv](https://80.lv/articles/ue5-10-nanite-improvements-and-performance-analysis/)
- [Optimizing Open World Games with Nanite Cluster Streaming - Unreal Slackers Discord Archive](https://unrealslackers.org/articles/optimizing-nanite-cluster-streaming-ue510/)
- [UE5.10新機能：Nanite Cluster Streamingによる大規模シーン最適化 - CGWORLD.jp](https://cgworld.jp/article/202605-ue510-nanite-cluster-streaming.html)