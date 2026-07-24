// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Router} from "../src/Router.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract RouterTest is Test {
    Router internal router;
    MockUSDC internal usdc;

    address internal owner = address(this);
    address internal executor = address(0xBEEF);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes32 internal constant ORDER_KEY = keccak256("cap-order-123");

    function setUp() public {
        usdc = new MockUSDC();
        router = new Router(executor, address(usdc));
        usdc.mint(address(router), 1_000_000);
    }

    function test_executeSplit_distributesUsdc() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 700_000;
        amounts[1] = 300_000;

        vm.prank(executor);
        uint256 total = router.executeSplit(ORDER_KEY, recipients, amounts, 1_000_000);

        assertEq(total, 1_000_000);
        assertEq(usdc.balanceOf(alice), 700_000);
        assertEq(usdc.balanceOf(bob), 300_000);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertTrue(router.executed(ORDER_KEY));
    }

    function test_executeSplit_revertsOnReplay() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000;

        vm.startPrank(executor);
        router.executeSplit(ORDER_KEY, recipients, amounts, 100_000);
        vm.expectRevert(Router.AlreadyExecuted.selector);
        router.executeSplit(ORDER_KEY, recipients, amounts, 100_000);
        vm.stopPrank();
    }

    function test_executeSplit_revertsForNonExecutor() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000;

        vm.prank(alice);
        vm.expectRevert(Router.NotExecutor.selector);
        router.executeSplit(ORDER_KEY, recipients, amounts, 100_000);
    }

    function test_executeSplit_revertsOnMismatchedArrays() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000;

        vm.prank(executor);
        vm.expectRevert(Router.InvalidArrayLength.selector);
        router.executeSplit(ORDER_KEY, recipients, amounts, 100_000);
    }

    function test_executeSplit_revertsWhenUnderfunded() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000_000;

        vm.prank(executor);
        vm.expectRevert(Router.InsufficientBalance.selector);
        router.executeSplit(ORDER_KEY, recipients, amounts, 2_000_000);
    }

    function test_executeSplit_revertsOnAmountMismatch() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000;

        vm.prank(executor);
        vm.expectRevert(Router.AmountMismatch.selector);
        router.executeSplit(ORDER_KEY, recipients, amounts, 200_000);
    }

    function test_setExecutor_onlyOwner() public {
        address newExec = address(0xCAFE);
        router.setExecutor(newExec);
        assertEq(router.executor(), newExec);

        vm.prank(alice);
        vm.expectRevert();
        router.setExecutor(address(1));
    }

    function test_rescueForeignToken() public {
        MockUSDC stray = new MockUSDC();
        stray.mint(address(router), 500_000);
        router.rescueForeignToken(address(stray), owner, 500_000);
        assertEq(stray.balanceOf(owner), 500_000);
    }

    function test_cannotRescuePayrollToken() public {
        vm.expectRevert(Router.CannotRescuePayrollToken.selector);
        router.rescueForeignToken(address(usdc), owner, 1);
    }
}
