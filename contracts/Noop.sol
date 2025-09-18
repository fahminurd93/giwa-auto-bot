// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;contract Noop{event Touched(address indexed from,uint256 value);receive() external payable{emit Touched(msg.sender,msg.value);}function touch() external payable{emit Touched(msg.sender,msg.value);}}
