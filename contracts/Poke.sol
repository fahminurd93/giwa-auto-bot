// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;contract Poke{uint256 public pings;event Poked(address indexed sender,uint256 value,uint256 newCount);function poke() external payable{unchecked{pings++;}emit Poked(msg.sender,msg.value,pings);}}
