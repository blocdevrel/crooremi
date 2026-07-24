// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Router} from "../src/Router.sol";

/// @notice Deploy Router to Base.
/// forge script script/DeployRouter.s.sol:DeployRouter --rpc-url $BASE_RPC_URL --broadcast
contract DeployRouter is Script {
    function run() external returns (Router router) {
        address executor = vm.envAddress("ROUTER_EXECUTOR_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        router = new Router(executor, usdc);
        vm.stopBroadcast();

        console2.log("Router deployed:", address(router));
        console2.log("USDC token:", usdc);
        console2.log("Executor:", executor);
        console2.log("Owner (deployer):", vm.addr(deployerKey));
        console2.log("");
        console2.log("Next steps:");
        console2.log("1. Set ROUTER_ADDRESS in Remifi .env / Railway");
        console2.log("2. CAP acceptNegotiationWithFundAddress(router address)");
        console2.log("3. ROUTER_EXECUTOR_ADDRESS must match executor private key on Remifi server");
    }
}
