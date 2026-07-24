// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Router
/// @notice Receives USDC from CROO CAP fund-transfer (payOrder) and splits to recipients in one tx.
/// @dev Declare this contract as providerFundAddress at acceptNegotiationWithFundAddress.
contract Router is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Payroll token (Base USDC). Fixed at deploy — no arbitrary token in executeSplit.
    IERC20 public immutable token;

    address public executor;

    /// @dev CAP order id hashed to bytes32 — prevents replay for the same payroll hire.
    mapping(bytes32 orderKey => bool) public executed;

    /// @dev Gas-safe upper bound on split legs per order.
    uint256 public constant MAX_RECIPIENTS = 50;

    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event SplitExecuted(
        bytes32 indexed orderKey,
        uint256 totalAmount,
        uint256 recipientCount
    );

    error NotExecutor();
    error AlreadyExecuted();
    error InvalidArrayLength();
    error ZeroRecipient();
    error ZeroAmount();
    error ZeroAddress();
    error AmountMismatch();
    error InsufficientBalance();
    error TooManyRecipients();
    error CannotRescuePayrollToken();

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address executor_, address token_) Ownable(msg.sender) {
        if (executor_ == address(0) || token_ == address(0)) revert ZeroAddress();
        executor = executor_;
        token = IERC20(token_);
        emit ExecutorUpdated(address(0), executor_);
    }

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        address previous = executor;
        executor = newExecutor;
        emit ExecutorUpdated(previous, newExecutor);
    }

    /// @notice Split payroll USDC to recipients (one CAP order = one call).
    /// @param orderKey keccak256(bytes(capOrderId)) from Remifi backend.
    /// @param recipients payout addresses — must match policy legs.
    /// @param amounts 6-decimal USDC base units per recipient.
    /// @param expectedTotal must equal sum(amounts); backend passes CAP fundAmount for this order.
    function executeSplit(
        bytes32 orderKey,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 expectedTotal
    ) external onlyExecutor nonReentrant returns (uint256 totalAmount) {
        if (executed[orderKey]) revert AlreadyExecuted();

        uint256 len = recipients.length;
        if (len == 0 || len != amounts.length) revert InvalidArrayLength();
        if (len > MAX_RECIPIENTS) revert TooManyRecipients();

        for (uint256 i = 0; i < len; i++) {
            address to = recipients[i];
            uint256 amount = amounts[i];
            if (to == address(0)) revert ZeroRecipient();
            if (amount == 0) revert ZeroAmount();
            totalAmount += amount;
        }

        if (totalAmount != expectedTotal) revert AmountMismatch();

        uint256 balance = token.balanceOf(address(this));
        if (balance < expectedTotal) revert InsufficientBalance();

        executed[orderKey] = true;

        for (uint256 i = 0; i < len; i++) {
            token.safeTransfer(recipients[i], amounts[i]);
        }

        emit SplitExecuted(orderKey, totalAmount, len);
    }

    /// @notice Recover non-payroll tokens sent to this contract by mistake.
    /// @dev Cannot rescue the configured payroll token — use executeSplit for USDC.
    function rescueForeignToken(address foreignToken, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (foreignToken == address(token)) revert CannotRescuePayrollToken();
        IERC20(foreignToken).safeTransfer(to, amount);
    }
}
