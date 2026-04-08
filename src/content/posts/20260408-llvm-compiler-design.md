---
title: "LLVM コンパイラ設計入門｜フロントエンド実装の基礎"
description: "LLVMを使ったコンパイラのフロントエンド設計を入門から解説。字句解析・構文解析・AST構築・LLVM IR生成まで、Kaleidoscope言語の実装例で体系的に学ぶ"
category: "low-level"
tags: ["LLVM", "コンパイラ", "フロントエンド", "低レイヤー"]
publishedAt: 2026-04-08
featured: false
---

## LLVMとは何か｜モダンコンパイラ基盤の全体像

LLVMは、コンパイラやツールチェインを構築するためのモジュラーなインフラストラクチャです。Clang（C/C++）、Rust、Swift、Juliaなど、現代の主要な言語処理系がLLVMをバックエンドとして採用しています。

コンパイラの構造は大きく3つのフェーズに分かれます。

1. **フロントエンド**: ソースコードを解析し、中間表現（IR）に変換する
2. **ミドルエンド**: IRに対して最適化パスを適用する
3. **バックエンド**: IRからターゲットアーキテクチャのマシンコードを生成する

LLVMの強みは、この3層が明確に分離されている点です。フロントエンドさえ自作すれば、最適化とコード生成はLLVMが担当してくれます。つまり、自作言語にx86、ARM、RISC-Vなどの多アーキテクチャ対応が自動的に手に入ります。

2026年現在、LLVMのバージョンは23.0系が開発中で、LLVM 20以降はレガシーパスマネージャが完全に廃止され、New Pass Managerに一本化されています。本記事ではLLVMのフロントエンド設計を、公式チュートリアルのKaleidoscope言語を題材に解説します。

## コンパイラフロントエンドの設計｜4つのステージ

フロントエンドは以下の4段階で構成されます。

```
ソースコード → [字句解析] → トークン列 → [構文解析] → AST → [意味解析] → AST' → [IR生成] → LLVM IR
```

各ステージを順に実装していきます。対象言語は、数値演算と関数定義をサポートする簡易言語「Kaleidoscope」です。

## 字句解析（Lexer）の実装｜ソースコードのトークン化

字句解析器（Lexer）は、文字の並びを意味のある単位（トークン）に分割します。`def foo(x) x + 1`という入力を、`[def] [foo] [(] [x] [)] [x] [+] [1]`というトークン列に変換します。

```cpp
#include <string>
#include <cctype>

// トークンの種類
enum Token {
    tok_eof = -1,

    // コマンド
    tok_def = -2,
    tok_extern = -3,

    // リテラル
    tok_identifier = -4,
    tok_number = -5,
};

static std::string IdentifierStr;  // tok_identifier の場合の識別子名
static double NumVal;              // tok_number の場合の数値

// 次のトークンを読み取って返す
static int gettok() {
    static int LastChar = ' ';

    // 空白をスキップ
    while (isspace(LastChar))
        LastChar = getchar();

    // 識別子: [a-zA-Z][a-zA-Z0-9]*
    if (isalpha(LastChar)) {
        IdentifierStr = LastChar;
        while (isalnum((LastChar = getchar())))
            IdentifierStr += LastChar;

        if (IdentifierStr == "def")    return tok_def;
        if (IdentifierStr == "extern") return tok_extern;
        return tok_identifier;
    }

    // 数値リテラル: [0-9.]+
    if (isdigit(LastChar) || LastChar == '.') {
        std::string NumStr;
        do {
            NumStr += LastChar;
            LastChar = getchar();
        } while (isdigit(LastChar) || LastChar == '.');

        NumVal = strtod(NumStr.c_str(), nullptr);
        return tok_number;
    }

    // コメント: # から行末まで
    if (LastChar == '#') {
        do {
            LastChar = getchar();
        } while (LastChar != EOF && LastChar != '\n' && LastChar != '\r');

        if (LastChar != EOF)
            return gettok();
    }

    // ファイル終端
    if (LastChar == EOF)
        return tok_eof;

    // その他の文字はASCII値をそのまま返す（演算子など）
    int ThisChar = LastChar;
    LastChar = getchar();
    return ThisChar;
}
```

このLexerのポイントは、`+`や`(`のような単一文字の演算子をASCII値としてそのまま返す設計です。特別なトークン型を定義する必要がなく、実装がシンプルになります。Lexerは1文字先読み（`LastChar`）を保持し、呼ばれるたびに次のトークンを返します。

## 構文解析（Parser）とAST構築｜再帰下降パーサーの実装

### AST（抽象構文木）の定義

ASTは、ソースコードの構造をツリーとして表現したものです。各ノード型を定義します。

```cpp
#include <memory>
#include <vector>
#include <map>

// ASTノードの基底クラス
class ExprAST {
public:
    virtual ~ExprAST() = default;
    virtual llvm::Value* codegen() = 0;  // LLVM IR生成（後述）
};

// 数値リテラル: 3.14
class NumberExprAST : public ExprAST {
    double Val;
public:
    NumberExprAST(double Val) : Val(Val) {}
    llvm::Value* codegen() override;
};

// 変数参照: x
class VariableExprAST : public ExprAST {
    std::string Name;
public:
    VariableExprAST(const std::string& Name) : Name(Name) {}
    llvm::Value* codegen() override;
};

// 二項演算: x + y
class BinaryExprAST : public ExprAST {
    char Op;
    std::unique_ptr<ExprAST> LHS, RHS;
public:
    BinaryExprAST(char Op, std::unique_ptr<ExprAST> LHS,
                  std::unique_ptr<ExprAST> RHS)
        : Op(Op), LHS(std::move(LHS)), RHS(std::move(RHS)) {}
    llvm::Value* codegen() override;
};

// 関数呼び出し: foo(x, y)
class CallExprAST : public ExprAST {
    std::string Callee;
    std::vector<std::unique_ptr<ExprAST>> Args;
public:
    CallExprAST(const std::string& Callee,
                std::vector<std::unique_ptr<ExprAST>> Args)
        : Callee(Callee), Args(std::move(Args)) {}
    llvm::Value* codegen() override;
};

// 関数プロトタイプ: foo(x y)
class PrototypeAST {
    std::string Name;
    std::vector<std::string> Args;
public:
    PrototypeAST(const std::string& Name, std::vector<std::string> Args)
        : Name(Name), Args(std::move(Args)) {}
    const std::string& getName() const { return Name; }
    llvm::Function* codegen();
};

// 関数定義: def foo(x y) x+y
class FunctionAST {
    std::unique_ptr<PrototypeAST> Proto;
    std::unique_ptr<ExprAST> Body;
public:
    FunctionAST(std::unique_ptr<PrototypeAST> Proto,
                std::unique_ptr<ExprAST> Body)
        : Proto(std::move(Proto)), Body(std::move(Body)) {}
    llvm::Function* codegen();
};
```

### 再帰下降パーサーと演算子優先度パーサー

パーサーはトークン列をASTに変換します。Kaleidoscopeでは、再帰下降パーサー（関数定義・関数呼び出し用）と演算子優先度パーサー（二項演算用）を組み合わせます。

```cpp
static int CurTok;
static int getNextToken() { return CurTok = gettok(); }

// 演算子の優先度テーブル
static std::map<char, int> BinopPrecedence;

static int GetTokPrecedence() {
    if (!isascii(CurTok)) return -1;
    int TokPrec = BinopPrecedence[CurTok];
    if (TokPrec <= 0) return -1;
    return TokPrec;
}

// 基本式のパース
static std::unique_ptr<ExprAST> ParsePrimary() {
    switch (CurTok) {
    case tok_identifier:
        return ParseIdentifierExpr();  // 変数参照または関数呼び出し
    case tok_number:
        return ParseNumberExpr();      // 数値リテラル
    case '(':
        return ParseParenExpr();       // 括弧式
    default:
        return nullptr;
    }
}

// 数値リテラルのパース
static std::unique_ptr<ExprAST> ParseNumberExpr() {
    auto Result = std::make_unique<NumberExprAST>(NumVal);
    getNextToken();  // 数値を消費
    return std::move(Result);
}

// 二項演算のパース（演算子優先度法）
static std::unique_ptr<ExprAST> ParseBinOpRHS(
    int ExprPrec, std::unique_ptr<ExprAST> LHS) {

    while (true) {
        int TokPrec = GetTokPrecedence();

        // 現在の演算子の優先度が閾値未満なら終了
        if (TokPrec < ExprPrec)
            return LHS;

        int BinOp = CurTok;
        getNextToken();  // 演算子を消費

        auto RHS = ParsePrimary();
        if (!RHS) return nullptr;

        // 次の演算子の優先度を確認
        int NextPrec = GetTokPrecedence();
        if (TokPrec < NextPrec) {
            // 次の演算子のほうが優先度が高い場合、RHSを先に結合
            RHS = ParseBinOpRHS(TokPrec + 1, std::move(RHS));
            if (!RHS) return nullptr;
        }

        // LHS と RHS を結合
        LHS = std::make_unique<BinaryExprAST>(BinOp, std::move(LHS),
                                               std::move(RHS));
    }
}

// 式のパース（エントリーポイント）
static std::unique_ptr<ExprAST> ParseExpression() {
    auto LHS = ParsePrimary();
    if (!LHS) return nullptr;
    return ParseBinOpRHS(0, std::move(LHS));
}
```

演算子優先度パーサーは、`1 + 2 * 3`を`1 + (2 * 3)`と正しく解析するために不可欠です。優先度テーブルで`*`を`+`より高い値に設定することで、結合順序を制御します。

## LLVM IR生成｜ASTからの中間表現コード生成

### IRBuilder の初期化

LLVM IRの生成には`IRBuilder`を使います。これがLLVM APIの中核です。

```cpp
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"

static std::unique_ptr<llvm::LLVMContext> TheContext;
static std::unique_ptr<llvm::IRBuilder<>> Builder;
static std::unique_ptr<llvm::Module> TheModule;
static std::map<std::string, llvm::Value*> NamedValues;

void InitializeModule() {
    TheContext = std::make_unique<llvm::LLVMContext>();
    TheModule = std::make_unique<llvm::Module>("my_module", *TheContext);
    Builder = std::make_unique<llvm::IRBuilder<>>(*TheContext);
}
```

`LLVMContext`はLLVMの型やコンスタントを管理するコンテナ、`Module`は関数やグローバル変数の集合、`IRBuilder`はIR命令を生成するヘルパーです。

### 各ASTノードのcodegen実装

各ASTノードの`codegen()`メソッドがLLVM IRを出力します。

```cpp
// 数値リテラル → 浮動小数点定数
llvm::Value* NumberExprAST::codegen() {
    return llvm::ConstantFP::get(*TheContext, llvm::APFloat(Val));
}

// 変数参照 → 名前テーブルから検索
llvm::Value* VariableExprAST::codegen() {
    llvm::Value* V = NamedValues[Name];
    if (!V) {
        // エラー: 未定義の変数
        return nullptr;
    }
    return V;
}

// 二項演算 → 対応するLLVM命令を生成
llvm::Value* BinaryExprAST::codegen() {
    llvm::Value* L = LHS->codegen();
    llvm::Value* R = RHS->codegen();
    if (!L || !R) return nullptr;

    switch (Op) {
    case '+':
        return Builder->CreateFAdd(L, R, "addtmp");
    case '-':
        return Builder->CreateFSub(L, R, "subtmp");
    case '*':
        return Builder->CreateFMul(L, R, "multmp");
    case '<':
        L = Builder->CreateFCmpULT(L, R, "cmptmp");
        // bool (i1) を double に変換
        return Builder->CreateUIToFP(L,
            llvm::Type::getDoubleTy(*TheContext), "booltmp");
    default:
        return nullptr;
    }
}

// 関数呼び出し → call命令を生成
llvm::Value* CallExprAST::codegen() {
    llvm::Function* CalleeF = TheModule->getFunction(Callee);
    if (!CalleeF) return nullptr;

    if (CalleeF->arg_size() != Args.size()) return nullptr;

    std::vector<llvm::Value*> ArgsV;
    for (auto& Arg : Args) {
        ArgsV.push_back(Arg->codegen());
        if (!ArgsV.back()) return nullptr;
    }

    return Builder->CreateCall(CalleeF, ArgsV, "calltmp");
}
```

ここで注目すべきは、`CreateFAdd`のような命令生成関数の最後の引数（`"addtmp"`）です。これはSSA値の名前で、生成されたIRのデバッグ時に役立ちます。LLVMのIRはSSA（Static Single Assignment）形式で、各値は一度だけ代入されます。

### 関数定義のコード生成

```cpp
// 関数プロトタイプ → LLVM Function宣言
llvm::Function* PrototypeAST::codegen() {
    // 全引数がdouble型の関数型を作成
    std::vector<llvm::Type*> Doubles(
        Args.size(), llvm::Type::getDoubleTy(*TheContext));

    llvm::FunctionType* FT = llvm::FunctionType::get(
        llvm::Type::getDoubleTy(*TheContext), Doubles, false);

    llvm::Function* F = llvm::Function::Create(
        FT, llvm::Function::ExternalLinkage, Name, TheModule.get());

    // 引数に名前を設定
    unsigned Idx = 0;
    for (auto& Arg : F->args())
        Arg.setName(Args[Idx++]);

    return F;
}

// 関数定義 → プロトタイプ + 本体のIR生成
llvm::Function* FunctionAST::codegen() {
    llvm::Function* TheFunction = TheModule->getFunction(Proto->getName());
    if (!TheFunction)
        TheFunction = Proto->codegen();
    if (!TheFunction) return nullptr;

    // 関数のエントリーブロックを作成
    llvm::BasicBlock* BB =
        llvm::BasicBlock::Create(*TheContext, "entry", TheFunction);
    Builder->SetInsertPoint(BB);

    // 引数を名前テーブルに登録
    NamedValues.clear();
    for (auto& Arg : TheFunction->args())
        NamedValues[std::string(Arg.getName())] = &Arg;

    // 関数本体のコード生成
    if (llvm::Value* RetVal = Body->codegen()) {
        Builder->CreateRet(RetVal);
        llvm::verifyFunction(*TheFunction);
        return TheFunction;
    }

    // エラー時は関数を削除
    TheFunction->eraseFromParent();
    return nullptr;
}
```

`def foo(x y) x + y`という入力から、以下のLLVM IRが生成されます。

```llvm
define double @foo(double %x, double %y) {
entry:
  %addtmp = fadd double %x, %y
  ret double %addtmp
}
```

人間が読んでも理解しやすいIRが生成されていることが分かります。この可読性はLLVMの大きな強みです。

## ビルドと実行｜LLVMプロジェクトの構築方法

### CMakeによるビルド設定

```cmake
cmake_minimum_required(VERSION 3.20)
project(kaleidoscope)

# LLVMパッケージの検索
find_package(LLVM REQUIRED CONFIG)

message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")

include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST NATIVE_COMMAND ${LLVM_DEFINITIONS})
add_definitions(${LLVM_DEFINITIONS_LIST})

# 実行ファイルの定義
add_executable(kaleidoscope main.cpp)

# 必要なLLVMコンポーネントをリンク
llvm_map_components_to_libnames(llvm_libs
    core
    support
    irreader
    native        # ネイティブターゲット
    orcjit        # JITコンパイル用
)

target_link_libraries(kaleidoscope ${llvm_libs})
target_compile_features(kaleidoscope PRIVATE cxx_std_17)
```

### LLVMのインストールとビルド

```bash
# Ubuntu/Debianでのインストール
sudo apt install llvm-18-dev libclang-18-dev

# macOSでのインストール
brew install llvm@18

# ビルド
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)

# 実行
echo "def foo(x y) x + y; foo(3.0, 4.0);" | ./kaleidoscope
```

## 最適化パスの適用｜New Pass Managerの使い方

LLVM 20以降、レガシーパスマネージャは完全に廃止されました。New Pass Managerを使って最適化を適用します。

```cpp
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Transforms/Scalar/GVN.h"
#include "llvm/Transforms/Scalar/Reassociate.h"
#include "llvm/Transforms/Scalar/SimplifyCFG.h"
#include "llvm/Transforms/InstCombine/InstCombine.h"

void optimizeModule(llvm::Module& M) {
    // パスビルダーの作成
    llvm::PassBuilder PB;

    // 解析マネージャの作成
    llvm::LoopAnalysisManager LAM;
    llvm::FunctionAnalysisManager FAM;
    llvm::CGSCCAnalysisManager CGAM;
    llvm::ModuleAnalysisManager MAM;

    // 解析マネージャの登録
    PB.registerModuleAnalyses(MAM);
    PB.registerCGSCCAnalyses(CGAM);
    PB.registerFunctionAnalyses(FAM);
    PB.registerLoopAnalyses(LAM);
    PB.crossRegisterProxies(LAM, FAM, CGAM, MAM);

    // O2レベルの標準最適化パイプラインを構築
    llvm::ModulePassManager MPM =
        PB.buildPerModuleDefaultPipeline(llvm::OptimizationLevel::O2);

    // 最適化を実行
    MPM.run(M, MAM);
}
```

`PassBuilder::buildPerModuleDefaultPipeline()`は、指定した最適化レベルに応じた標準的なパス構成を自動的に組み立てます。O0からO3、Osなどのレベルが利用可能です。解析結果のキャッシュは解析マネージャが自動管理するため、同じ解析を何度も計算するコストが発生しません。

## JITコンパイルの実装｜対話的な言語処理系

LLVMのORC JITを使うと、コンパイルした関数を即座に実行できます。

```cpp
#include "llvm/ExecutionEngine/Orc/LLJIT.h"

// JITの初期化
auto JIT = llvm::orc::LLJITBuilder().create();
if (!JIT) {
    // エラー処理
    return;
}

// モジュールをJITに追加
auto TSM = llvm::orc::ThreadSafeModule(
    std::move(TheModule), std::move(TheContext));
(*JIT)->addIRModule(std::move(TSM));

// シンボルを検索して実行
auto ExprSymbol = (*JIT)->lookup("__anon_expr");
if (!ExprSymbol) {
    // エラー処理
    return;
}

// 関数ポインタとして呼び出し
double (*FP)() = ExprSymbol->toPtr<double (*)()>();
double result = FP();
```

JITコンパイルにより、REPLのような対話的環境が実現できます。式を入力するたびにLLVM IRにコンパイルし、JITで即座に実行して結果を表示する、というフローです。

## まとめ

- LLVMは**フロントエンド・ミドルエンド・バックエンド**の3層構造で、フロントエンドを自作すれば最適化とコード生成は自動的に得られる
- フロントエンドは**字句解析→構文解析→AST構築→IR生成**の4ステージで構成される
- 字句解析器は1文字先読みのシンプルな設計で、演算子はASCII値をそのまま返す
- 構文解析には**再帰下降パーサー**と**演算子優先度パーサー**の組み合わせが実用的
- 各ASTノードの`codegen()`メソッドが`IRBuilder`を使ってLLVM IRを出力する
- LLVM 20以降は**New Pass Manager**に一本化されており、`PassBuilder`で最適化パイプラインを構築する
- ORC JITを使えば、コンパイル結果を即座に実行する対話的環境も構築可能
