{
  description = "jsonlxlsx public clean root artifacts";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      apps = forAllSystems (pkgs: {
        generate-artifacts = { type = "app"; program = "${pkgs.writeShellScript "jsonlxlsx-generate-artifacts" ''exec ${pkgs.nodejs_22}/bin/node scripts/generate-artifacts.mjs''}"; };
        check-artifacts = { type = "app"; program = "${pkgs.writeShellScript "jsonlxlsx-check-artifacts" ''exec ${pkgs.nodejs_22}/bin/node scripts/check-artifacts.mjs''}"; };
      });
      checks = forAllSystems (pkgs: {
        artifacts = pkgs.runCommand "jsonlxlsx-artifact-check" { src = ./.; nativeBuildInputs = [ pkgs.nodejs_22 ]; } ''
          cp -R "$src" work
          chmod -R u+w work
          cd work
          node scripts/check-artifacts.mjs
          touch "$out"
        '';
      });
    };
}
