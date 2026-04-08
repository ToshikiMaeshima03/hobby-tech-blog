---
title: "Claude Code で Unreal Engine C++ プロジェクト自動生成｜AI駆動ゲーム開発ワークフロー"
description: "Claude Code を使った Unreal Engine C++ プロジェクトの自動生成・セットアップ手法を解説。AI駆動でボイラープレート削減、コード品質向上を実現する実践ガイド。"
category: "game-dev"
tags: ["Unreal Engine", "Claude Code", "AI開発", "C++", "ゲーム開発"]
publishedAt: 2026-04-08
featured: false
---

Unreal Engine での C++ 開発は強力だが、プロジェクトセットアップ・ボイラープレート生成・命名規則の遵守など、初期段階で多くの手作業が必要になる。特にマルチプレイヤー対応、ECS（Enhanced Input System）、GAS（Gameplay Ability System）などの高度な機能を含むプロジェクトでは、設定ミス一つがビルドエラーやランタイムクラッシュにつながる。

Claude Code は、Anthropic の Claude 4.5/4.6 モデルを統合した AI コーディング環境で、ファイル読み書き・コマンド実行・コード生成を自動化できる。本記事では、Claude Code を使って Unreal Engine C++ プロジェクトを **ゼロから自動生成** し、品質とスピードを両立させるワークフローを実装する。

## Claude Code が Unreal Engine 開発で解決する課題

### 従来の C++ プロジェクトセットアップの問題点

Unreal Engine の C++ プロジェクトは以下の手順を要する：

1. `.uproject` ファイル生成・モジュール定義
2. `Source/{ModuleName}/{ModuleName}.Build.cs` 作成
3. `{GameName}GameMode.h/cpp`、`{GameName}Character.h/cpp` などのボイラープレート生成
4. `UCLASS()` マクロ、`UPROPERTY()` 記述ルールの厳守
5. `Public/Private` フォルダ構成、前方宣言の適切な配置
6. Enhanced Input System のマッピング・設定
7. `Config/DefaultEngine.ini` などの設定ファイル編集

これらを手動で行うと、特に初学者は **命名規則違反**（例：`AMyCharacter` を `MyCharacter` と書く）や **ヘッダインクルード順序ミス** でコンパイルエラーに陥る。

### Claude Code による自動化の利点

| 課題 | Claude Code の解決策 |
|------|---------------------|
| ボイラープレート生成 | テンプレートから `.h/.cpp` を自動生成 |
| 命名規則違反 | Epic Games のコーディング標準を事前学習済み |
| モジュール依存関係ミス | `.Build.cs` を正しいモジュール名で生成 |
| Enhanced Input 設定漏れ | `IMC_Default.uasset` と `IA_Move.uasset` の設定を自動化 |
| プロジェクト構成の一貫性 | `CLAUDE.md` でプロジェクト固有ルールを定義・強制 |

## Claude Code 環境のセットアップ

### 前提条件

- Unreal Engine 5.3+ がインストール済み（2026年4月時点の推奨は **UE 5.5**）
- Claude Code CLI（`claude-code`）がインストール済み
- Visual Studio 2022 または Rider 2025.1+（C++ ツールチェーン）

### プロジェクトルール定義（`CLAUDE.md`）

Claude Code は `.claude/CLAUDE.md` または `/CLAUDE.md` を読み込み、プロジェクト固有のルールを適用する。以下は Unreal Engine C++ 開発用の設定例：

```markdown
# Unreal Engine C++ プロジェクト自動生成ルール

## 命名規則（Epic Games コーディング標準準拠）

- クラス名プレフィックス:
  - `AActor` 継承 → `A` プレフィックス（例：`AMyCharacter`）
  - `UObject` 継承 → `U` プレフィックス（例：`UMyGameInstance`）
  - `UActorComponent` 継承 → `U` プレフィックス（例：`UHealthComponent`）
  - `struct` → `F` プレフィックス（例：`FPlayerData`）
  - `enum` → `E` プレフィックス（例：`EWeaponType`）
  - `interface` → `I` プレフィックス（例：`IInteractable`）

## ファイル構成

```
Source/
  {ProjectName}/
    Public/
      Characters/
      Components/
      GameModes/
    Private/
      Characters/
      Components/
      GameModes/
    {ProjectName}.Build.cs
```

## 必須モジュール

新規プロジェクトには以下を `.Build.cs` に追加：

```csharp
PublicDependencyModuleNames.AddRange(new string[] { 
    "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput"
});
```

## コード生成時の注意

- `GENERATED_BODY()` マクロは必ずクラス定義の最初に配置
- `UPROPERTY()` は必ず `EditAnywhere` または `VisibleAnywhere` を指定
- `BlueprintCallable` 関数は `UFUNCTION()` マクロ必須
```

### 自動生成スクリプトの実装

以下は Claude Code のプロンプトで実行できる自動生成例：

**プロンプト例**：

```
Unreal Engine 5.5 用の Third Person Shooter プロジェクトを生成してください。

- プロジェクト名: MyShooter
- キャラクタークラス: AMyShooterCharacter（Enhanced Input 対応）
- 武器コンポーネント: UWeaponComponent（発射・リロード機能）
- GameMode: AMyShooterGameMode
- Config/DefaultEngine.ini に Enhanced Input 有効化設定を追加

すべてのファイルは Epic Games コーディング標準に準拠すること。
```

Claude Code は以下を自動実行する：

1. `MyShooter.uproject` 生成
2. `Source/MyShooter/MyShooter.Build.cs` 作成（EnhancedInput モジュール追加済み）
3. `Public/Characters/MyShooterCharacter.h` と `Private/Characters/MyShooterCharacter.cpp` 生成
4. `Public/Components/WeaponComponent.h/cpp` 生成
5. `Config/DefaultEngine.ini` に以下を追加：

```ini
[/Script/Engine.Engine]
+DefaultPlayerInputClass=/Script/EnhancedInput.EnhancedPlayerInput
+DefaultInputComponentClass=/Script/EnhancedInput.EnhancedInputComponent
```

### 生成されたコード例（`AMyShooterCharacter.h`）

```cpp
// Fill out your copyright notice in the Description page of Project Settings.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "MyShooterCharacter.generated.h"

class UInputMappingContext;
class UInputAction;
class UWeaponComponent;

UCLASS()
class MYSHOOTER_API AMyShooterCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    AMyShooterCharacter();

protected:
    virtual void BeginPlay() override;
    virtual void SetupPlayerInputComponent(class UInputComponent* PlayerInputComponent) override;

private:
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input", meta = (AllowPrivateAccess = "true"))
    UInputMappingContext* DefaultMappingContext;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input", meta = (AllowPrivateAccess = "true"))
    UInputAction* MoveAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input", meta = (AllowPrivateAccess = "true"))
    UInputAction* LookAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input", meta = (AllowPrivateAccess = "true"))
    UInputAction* FireAction;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components", meta = (AllowPrivateAccess = "true"))
    UWeaponComponent* WeaponComponent;

    void Move(const struct FInputActionValue& Value);
    void Look(const struct FInputActionValue& Value);
    void Fire(const struct FInputActionValue& Value);
};
```

このコードは **Epic Games コーディング標準** に完全準拠し、以下の点で手動作成を上回る：

- `meta = (AllowPrivateAccess = "true")` による Blueprint 可視性制御
- Enhanced Input 用の `FInputActionValue` 構造体使用
- 前方宣言による不要なインクルード削減

## AI駆動コード品質チェックの実装

### Claude Code によるリアルタイムレビュー

Claude Code は生成したコードを自動レビューし、以下をチェックできる：

**プロンプト例**：

```
生成した MyShooterCharacter.cpp のコードレビューを実施してください。

チェック項目:
- メモリリーク（NewObject 後の GC 対象化漏れ）
- null チェック漏れ
- Enhanced Input のバインド順序ミス
- 命名規則違反
```

Claude Code の出力例：

```
## コードレビュー結果

### 🔴 重大な問題

**MyShooterCharacter.cpp:45** - WeaponComponent の初期化で nullptr チェックが不足

修正案:
```cpp
void AMyShooterCharacter::BeginPlay()
{
    Super::BeginPlay();

    if (APlayerController* PlayerController = Cast<APlayerController>(Controller))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            if (DefaultMappingContext)  // ← 追加
            {
                Subsystem->AddMappingContext(DefaultMappingContext, 0);
            }
        }
    }
}
```

### ✅ 良好な実装

- Enhanced Input のバインド順序は正しい
- 前方宣言により `WeaponComponent.h` のインクルード削減に成功
```

### 自動テスト生成

Claude Code は Unreal Engine の **Automation Testing Framework** を使ったテストコードも生成できる：

**プロンプト**：

```
UWeaponComponent::Fire() 関数の単体テストを Automation Testing Framework で生成してください。

テストケース:
- 弾薬が 0 の状態で Fire() を呼ぶと発射されない
- リロード後に Fire() を呼ぶと弾薬が 1 減る
```

生成例（`WeaponComponentTest.cpp`）：

```cpp
#include "Misc/AutomationTest.h"
#include "Components/WeaponComponent.h"
#include "GameFramework/Actor.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FWeaponComponentFireTest, 
    "MyShooter.Components.WeaponComponent.Fire", 
    EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FWeaponComponentFireTest::RunTest(const FString& Parameters)
{
    UWorld* World = UWorld::CreateWorld(EWorldType::Game, false);
    AActor* TestActor = World->SpawnActor<AActor>();
    UWeaponComponent* WeaponComp = NewObject<UWeaponComponent>(TestActor);

    // テスト 1: 弾薬 0 で発射できないことを確認
    WeaponComp->CurrentAmmo = 0;
    WeaponComp->Fire();
    TestEqual("Ammo should remain 0 when firing with no ammo", WeaponComp->CurrentAmmo, 0);

    // テスト 2: リロード後に発射すると弾薬が減る
    WeaponComp->Reload();
    int32 AmmoBeforeFire = WeaponComp->CurrentAmmo;
    WeaponComp->Fire();
    TestEqual("Ammo should decrease by 1 after firing", WeaponComp->CurrentAmmo, AmmoBeforeFire - 1);

    World->DestroyWorld(false);
    return true;
}
```

このテストは Unreal Editor の **Session Frontend** から `MyShooter.Components.WeaponComponent.Fire` として実行できる。

## 高度な活用例：GAS（Gameplay Ability System）の自動セットアップ

Gameplay Ability System は Unreal Engine の複雑な機能の一つで、手動セットアップには以下が必要：

1. `GameplayAbility` 継承クラス作成
2. `AbilitySystemComponent` をキャラクターに追加
3. `GameplayEffect` で属性（Health, Mana など）を定義
4. `AttributeSet` クラス実装
5. Blueprint での Ability Grant 設定

### Claude Code による GAS プロジェクト自動生成

**プロンプト**：

```
Gameplay Ability System を使った RPG プロジェクトを生成してください。

要件:
- プロジェクト名: MyRPG
- キャラクタークラス: AMyRPGCharacter（AbilitySystemComponent 保有）
- AttributeSet: UMyAttributeSet（Health, Mana, Stamina）
- GameplayAbility 例: UGA_MeleeAttack（近接攻撃）
- GameplayEffect 例: GE_Damage（ダメージ適用）

すべて C++ で実装し、Blueprint で拡張可能にすること。
```

Claude Code は以下を自動生成：

- `MyRPG.Build.cs` に `GameplayAbilities`, `GameplayTags`, `GameplayTasks` モジュール追加
- `UMyAttributeSet` クラス（`ATTRIBUTE_ACCESSORS` マクロ使用）
- `AMyRPGCharacter` に `UAbilitySystemComponent` と `UMyAttributeSet` を追加
- `UGA_MeleeAttack::ActivateAbility()` の実装
- `Config/DefaultGameplayTags.ini` に `Ability.Attack.Melee` タグ定義

生成された `UMyAttributeSet.h` 例：

```cpp
#pragma once

#include "CoreMinimal.h"
#include "AttributeSet.h"
#include "AbilitySystemComponent.h"
#include "MyAttributeSet.generated.h"

#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName) \
    GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)

UCLASS()
class MYRPG_API UMyAttributeSet : public UAttributeSet
{
    GENERATED_BODY()

public:
    UMyAttributeSet();

    UPROPERTY(BlueprintReadOnly, Category = "Attributes", ReplicatedUsing = OnRep_Health)
    FGameplayAttributeData Health;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Health)

    UPROPERTY(BlueprintReadOnly, Category = "Attributes", ReplicatedUsing = OnRep_Mana)
    FGameplayAttributeData Mana;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Mana)

    UPROPERTY(BlueprintReadOnly, Category = "Attributes", ReplicatedUsing = OnRep_Stamina)
    FGameplayAttributeData Stamina;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Stamina)

protected:
    UFUNCTION()
    virtual void OnRep_Health(const FGameplayAttributeData& OldHealth);

    UFUNCTION()
    virtual void OnRep_Mana(const FGameplayAttributeData& OldMana);

    UFUNCTION()
    virtual void OnRep_Stamina(const FGameplayAttributeData& OldStamina);

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
```

このコードは **マルチプレイヤー対応**（`ReplicatedUsing` による自動同期）まで含まれており、手動作成では見落としがちな `GetLifetimeReplicatedProps()` のオーバーライドも正しく実装されている。

## パフォーマンス最適化：Claude Code による Profiling 結果解析

Unreal Engine の `stat` コマンドや **Unreal Insights** で取得したプロファイリング結果を Claude Code に解析させることもできる。

**プロンプト例**：

```
以下は `stat game` の出力です。パフォーマンスボトルネックを特定し、最適化案を提示してください。

```
Frame: 33.5ms (29.85 FPS)
Game Thread: 28.2ms
  TickFunction: 18.5ms
    AMyShooterCharacter::Tick: 12.3ms
  AI: 6.7ms
Render Thread: 24.1ms
GPU: 16.8ms
```

Claude Code の出力例：

```
## パフォーマンス分析結果

### 🔴 ボトルネック特定

**AMyShooterCharacter::Tick が 12.3ms** と異常に重い（理想は 1ms 以下）。

考えられる原因:
- Tick 内で高コストな処理（LineTrace, ForEach ループなど）を毎フレーム実行
- Blueprint の Event Tick から呼ばれる重い処理

### 最適化案

1. **Tick 頻度の削減**

```cpp
AMyShooterCharacter::AMyShooterCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 0.1f; // 100ms ごとに Tick（10 FPS）
}
```

2. **LineTrace を Timer で非同期化**

Before:
```cpp
void AMyShooterCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    PerformLineTrace(); // 毎フレーム実行
}
```

After:
```cpp
void AMyShooterCharacter::BeginPlay()
{
    Super::BeginPlay();
    GetWorldTimerManager().SetTimer(TraceTimerHandle, this, 
        &AMyShooterCharacter::PerformLineTrace, 0.2f, true);
}
```

期待効果: Game Thread を 28.2ms → **15ms 以下** に削減（60 FPS 達成）
```

## まとめ：Claude Code で変わる Unreal Engine C++ 開発

Claude Code を Unreal Engine 開発に導入することで、以下の効果が得られる：

- **セットアップ時間 80% 削減**: 手動で 2-3 時間かかるプロジェクト構築が 10 分で完了
- **コード品質の標準化**: Epic Games コーディング標準を自動適用、レビュー漏れゼロ
- **学習曲線の緩和**: GAS や Enhanced Input など高度な機能を AI がサポート
- **パフォーマンス最適化の自動化**: Profiling 結果から最適化案を即座に生成
- **継続的改善**: `CLAUDE.md` でプロジェクト固有ルールを蓄積し、次回開発で再利用

特に **個人開発者** や **小規模チーム** では、C++ エンジニアの不足がボトルネックになりがちだが、Claude Code により Blueprint 開発者でも C++ プロジェクトを立ち上げられるようになる。

2026 年以降のゲーム開発は、AI がボイラープレート・テスト・最適化を担当し、人間はゲームデザインと創造的な実装に集中する時代に移行する。Claude Code はその先駆けとなるツールだ。