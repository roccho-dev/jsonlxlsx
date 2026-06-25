{
  description = "jsonlxlsx hucre backend proposal checks";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          smoke-e2e = pkgs.buildNpmPackage {
            pname = "jsonlxlsx-hucre-smoke-e2e";
            version = "0.2.0-hucre-backend";
            src = self;
            npmDepsHash = "sha256-7cjJNw1CJ1BOSrozWjhFopBmOLk+/bAz/zT47nS59Js=";
            dontNpmBuild = true;
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm run shiftleft
              node src/adapters/cli/node.mjs compile examples/demo_design.jsonl "$TMPDIR/demo.xlsx"
              node src/adapters/cli/node.mjs validate "$TMPDIR/demo.xlsx"
              runHook postCheck
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R src test tools docs examples package.json package-lock.json README.md "$out"/
              runHook postInstall
            '';
          };
        });

      packages = forAllSystems (system: {
        default = self.checks.${system}.smoke-e2e;
      });
    };
}
